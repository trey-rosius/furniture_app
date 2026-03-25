import sys, asyncio, os, json, httpx, traceback, uuid, boto3
from datetime import datetime, timedelta
from unittest.mock import MagicMock
sys.modules["pyaudio"] = MagicMock()

from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from starlette.websockets import WebSocket, WebSocketDisconnect
from aws_lambda_powertools import Logger

# Hardened Monkey-patch: Bedrock/Strands sometimes yields numeric tool input fragments
# which cause TypeErrors in strands.event_loop.streaming when concatenating.
try:
    import strands.event_loop.streaming as st
    orig = st.handle_content_block_delta
    def patch(delta, state):
        try:
            if state and isinstance(state, dict):
                ctu = state.get("current_tool_use")
                if isinstance(ctu, dict) and "input" in ctu:
                    if not isinstance(ctu["input"], str): ctu["input"] = str(ctu["input"] or "")
            if isinstance(delta, dict):
                tu = delta.get("toolUse")
                if isinstance(tu, dict) and "input" in tu:
                    if not isinstance(tu["input"], str): tu["input"] = str(tu["input"] or "")
        except: pass
        return orig(delta, state)
    st.handle_content_block_delta = patch
except: pass

logger = Logger()
os.environ["BYPASS_TOOL_CONSENT"] = "true"

class TM:
    def __init__(self, cid, sec, ep, sc):
        self.cid, self.sec, self.ep, self.sc = cid, sec, ep, sc
        self._t, self._e = None, None
    async def get(self):
        if self._t and self._e and self._e > datetime.now(): return self._t
        async with httpx.AsyncClient() as c:
            r = await c.post(self.ep, data={'grant_type': 'client_credentials', 'client_id': self.cid, 'client_secret': self.sec, 'scope': self.sc})
            d = r.json()
            self._t, self._e = d['access_token'], datetime.now() + timedelta(seconds=d.get('expires_in', 3600)-300)
            return self._t

tm = TM(os.environ.get("GATEWAY_CLIENT_ID"), os.environ.get("GATEWAY_CLIENT_SECRET"), os.environ.get("GATEWAY_TOKEN_ENDPOINT"), os.environ.get("GATEWAY_SCOPE", "FurnitureGateway/invoke"))
app = BedrockAgentCoreApp()

PROMPT = """You are LuxeHome's elite AI design assistant. 
1. Provide concise, professional advice.
2. Use tools for catalog and payments.
3. NEVER read URLs or IDs aloud.
4. CRITICAL: Stripe payment links (buy.stripe.com/test_...) MUST be shared as a single continuous string. 
   NEVER add a space after 'test_'. 
   Output: https://buy.stripe.com/test_REMAINING_CODE
   (Incorrect example: https://buy.stripe.com/test_ 12345)
"""

@app.websocket
async def websocket_endpoint(ws: WebSocket, context=None):
    await ws.accept()
    try:
        from strands.experimental.bidi.models.nova_sonic import BidiNovaSonicModel as Model
        from strands.experimental.bidi.agent import BidiAgent as Bidi
        tok = await tm.get()
        cli = MCPClient(lambda: streamablehttp_client(os.environ.get("GATEWAY_URL"), headers={"Authorization": f"Bearer {tok}"}))
        with cli:
            tools = cli.list_tools_sync()
            agent = Bidi(model=Model(region=os.environ.get("AWS_REGION", "us-east-1"), model_id=os.environ.get("VOICE_MODEL_ID", "amazon.nova-2-sonic-v1:0"), tools=tools), tools=tools, system_prompt=PROMPT)
            async def inp():
                m = await ws.receive_json()
                if m.get("type") == "text_input": m["type"] = "bidi_text_input"
                return m
            await agent.run(inputs=[inp], outputs=[ws.send_json])
    except: pass
    finally: await ws.close()

@app.entrypoint
async def agent_invocation(payload, context):
    try:
        tok = await tm.get()
        cli = MCPClient(lambda: streamablehttp_client(os.environ.get("GATEWAY_URL"), headers={"Authorization": f"Bearer {tok}"}))
        with cli:
            tools = cli.list_tools_sync()
            agent = Agent(model=BedrockModel(region_name=os.environ.get("AWS_REGION", "us-east-1"), model_id=os.environ.get("TEXT_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")), tools=tools, system_prompt=PROMPT)
            res = await asyncio.to_thread(agent, payload.get("prompt", "Hello"))
            msg = res.message if hasattr(res, "message") else res
            content = []
            for p in (msg.content if hasattr(msg, "content") else msg.get("content", [])):
                t = getattr(p, "text", None) or (p.get("text") if isinstance(p, dict) else None)
                if t: content.append({"text": t})
            yield {"type": "message", "message": {"role": "assistant", "content": content}}
            products = []
            for m in agent.messages:
                for p in (m.content if hasattr(m, "content") else m.get("content", [])):
                    tr = getattr(p, "tool_result", None) or getattr(p, "toolResult", None) or (p.get("tool_result") or p.get("toolResult") if isinstance(p, dict) else None)
                    if tr and (c_list := (tr.content if hasattr(tr, "content") else tr.get("content", []))):
                        for c in c_list:
                            if txt := (getattr(c, "text", None) or (c.get("text") if isinstance(c, dict) else None)):
                                try:
                                    d = json.loads(txt)
                                    if isinstance(d, list): products.extend(d)
                                    elif isinstance(d, dict) and "products" in d: products.extend(d["products"])
                                except: pass
            if products: yield {"type": "tool_result", "products": products[:10]}
    except Exception as e:
        yield {"type": "error", "message": str(e), "trace": traceback.format_exc()}

if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8080)))
