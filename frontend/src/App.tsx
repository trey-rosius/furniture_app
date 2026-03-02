import React, { useState, useRef, useEffect } from "react";
import { generateClient } from "aws-amplify/api";
import { withAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import {
  UploadCloud,
  Search,
  Play,
  Image as ImageIcon,
  Send,
  Mic,
  MicOff,
  Volume2,
} from "lucide-react";

const client = generateClient();

function PresignedImage({ uri, alt }: { uri: string; alt: string }) {
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!uri) return;
    if (!uri.startsWith("s3://")) {
      setUrl(uri);
      return;
    }

    const fetchUrl = async () => {
      try {
        const res = await client.graphql({
          query: `mutation GetPresignedUrl($uri: String!) {
            getPresignedUrl(uri: $uri)
          }`,
          variables: { uri },
        });
        //@ts-ignore
        setUrl(res.data.getPresignedUrl);
      } catch (err) {
        console.error("Error fetching presigned url", err);
        setError(true);
      }
    };
    fetchUrl();
  }, [uri]);

  if (error)
    return <img src="https://via.placeholder.com/80?text=Error" alt={alt} />;
  if (!url) return <div className="spinner"></div>;

  return <img src={url} alt={alt} onError={() => setError(true)} />;
}

function App({ signOut, user }: { signOut?: () => void; user?: any }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Voice Chat State
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  // const [voiceSessionId, setVoiceSessionId] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const voiceClientRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  // Agent State
  const [agentPrompt, setAgentPrompt] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "ai"; text: string }[]
  >([
    {
      role: "ai",
      text: "Hello! I am your Furniture AI Assistant. How can I help you today?",
    },
  ]);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Manual Push State
  const [pushRequestId, setPushRequestId] = useState("test-123");
  const [pushProductName, setPushProductName] = useState("Fake Modern Sofa");

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${time}] ${message}`]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      addLog(`Selected file: ${e.target.files[0].name}`);
    }
  };

  const triggerCatalogProcessing = async () => {
    addLog("Triggering catalog processing...");
    try {
      const response = await client.graphql({
        query: `mutation TriggerCatalogProcessing { triggerCatalogProcessing }`,
      });
      addLog(`Catalog processing response: ${JSON.stringify(response)}`);
    } catch (err) {
      addLog(`Error triggering catalog: ${JSON.stringify(err)}`);
    }
  };

  const startVisualSearch = async () => {
    if (!selectedFile) {
      addLog("No file selected!");
      return;
    }

    setIsUploading(true);
    setIsSearching(true);
    setResults([]);

    try {
      addLog(`Requesting upload URL for ${selectedFile.name}...`);

      const response = await client.graphql({
        query: `mutation GetUploadUrl($fileName: String!, $contentType: String!) {
          getUploadUrl(fileName: $fileName, contentType: $contentType) {
            url
            key
          }
        }`,
        variables: {
          fileName: selectedFile.name,
          contentType: selectedFile.type || "image/jpeg",
        },
      });

      //@ts-ignore
      const { url, key } = response.data.getUploadUrl;
      addLog(`URL received. Target key: ${key}`);

      // Setup subscription BEFORE uploading to avoid missing the event
      addLog(`Subscribing to results...`);
      const sub = client
        .graphql({
          query: `subscription OnSearchResult {
          onSearchResult {
            status
            message
            results {
              productName
              category
              subCategory
              price
              image_uri
            }
          }
        }`,
          // @ts-ignore
        } as any)
        //@ts-ignore
        .subscribe({
          next: ({ data }: any) => {
            //@ts-ignore
            const resPayload = data.onSearchResult;
            if (resPayload.status === "ERROR") {
              addLog(`❌ SEARCH ERROR: ${resPayload.message}`);
              setResults([]);
            } else {
              addLog(
                `🎉 REAL-TIME RESULTS RECEIVED! Status: ${resPayload.status}`,
              );
              const items = resPayload.results || [];
              setResults(items);
              addLog(
                `${resPayload.message} (Found ${items.length} matched products)`,
              );
            }
            setIsSearching(false);
            sub.unsubscribe();
          },
          error: (err: any) => {
            addLog(`Subscription error: ${JSON.stringify(err)}`);
            setIsSearching(false);
          },
        });

      addLog(`Uploading file to S3...`);
      const uploadRes = await fetch(url, {
        method: "PUT",
        body: selectedFile,
        headers: { "Content-Type": selectedFile.type || "image/jpeg" },
      });

      if (uploadRes.ok) {
        addLog("Upload successful! Waiting for Vector Search to finish...");
      } else {
        addLog(`Upload failed: ${uploadRes.statusText}`);
        setIsSearching(false);
      }
      setIsUploading(false);
    } catch (err: any) {
      addLog(
        `Error during visual search flow: ${err.message || JSON.stringify(err)}`,
      );
      setIsUploading(false);
      setIsSearching(false);
    }
  };

  const invokeAgent = async () => {
    if (!agentPrompt || isAgentLoading) return;

    const userMessage = agentPrompt;
    setAgentPrompt("");
    setMessages((prev) => [...prev, { role: "user", text: userMessage }]);
    setIsAgentLoading(true);

    addLog(`Invoking agent with prompt: ${userMessage}`);
    try {
      const response = await client.graphql({
        query: `mutation InvokeAgent($prompt: String!) {
          invokeAgent(prompt: $prompt) {
            message
          }
        }`,
        variables: { prompt: userMessage },
      });
      //@ts-ignore
      const result = response.data.invokeAgent.message;
      setMessages((prev) => [...prev, { role: "ai", text: result }]);
      addLog(`Agent response: ${result}`);
    } catch (err: any) {
      addLog(`Error invoking agent: ${err.message || JSON.stringify(err)}`);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: "Sorry, I encountered an error while processing your request.",
        },
      ]);
    }
    setIsAgentLoading(false);
  };
  const manualSubscribeAndPush = async () => {
    addLog(`Subscribing specifically to manual push`);

    // 1. Subscribe
    const sub = client
      .graphql({
        query: `subscription OnSearchResult {
        onSearchResult {
          status
          message
          results {
            productName
            category
            subCategory
            price
            image_uri
          }
        }
      }`,
        // @ts-ignore
      } as any)
      //@ts-ignore
      .subscribe({
        next: ({ data }: any) => {
          //@ts-ignore
          const resPayload = data.onSearchResult;
          if (resPayload.status === "ERROR") {
            addLog(
              `❌ MANUAL PUSH ERROR EVENT RECEIVED! | Msg: ${resPayload.message}`,
            );
            setResults([]);
          } else {
            addLog(`🎉 MANUAL PUSH RECEIVED! | Status: ${resPayload.status}`);
            const items = resPayload.results || [];
            setResults(items);
            addLog(`${resPayload.message} (Product: ${items[0]?.productName})`);
          }
          sub.unsubscribe();
        },
        error: (err: any) => {
          addLog(`Subscription error: ${JSON.stringify(err)}`);
        },
      });

    addLog("Waiting 2 seconds before pushing (simulating search delay)...");

    // 2. Wait a bit, then Push
    setTimeout(async () => {
      addLog(`Pushing result...`);
      try {
        const res = await client.graphql({
          query: `mutation PushTestResult($productName: String!) {
            pushSearchResult(
              status: "SUCCESS",
              message: "Fake push succeeded.",
              results: [
                {
                  productName: $productName,
                  category: "Living Room",
                  subCategory: "Couches",
                  price: 999.99,
                  imageFile: "fake_sofa.jpg",
                  image_uri: "s3://fake/fake_sofa.jpg",
                  level: "Premium",
                  original_productId: "prod-001"
                }
              ]
            ) {
              status
            }
          }`,
          variables: {
            productName: pushProductName,
          },
        });
        addLog(`Push successful: ${JSON.stringify(res)}`);
      } catch (err) {
        addLog(`Push failed: ${JSON.stringify(err)}`);
      }
    }, 2000);
  };

  const startVoiceChat = async () => {
    addLog("Initialing Voice Chat...");
    try {
      const configRes = await client.graphql({
        query: `mutation GetWebsocketConfig { getAgentWebsocketConfig { url } }`,
      });
      //@ts-ignore
      if (!configRes.data?.getAgentWebsocketConfig) {
        addLog(`❌ Mutation Error: ${JSON.stringify(configRes)}`);
        return;
      }
      //@ts-ignore
      const url = configRes.data.getAgentWebsocketConfig.url;
      addLog(`Connecting to AgentCore WebSocket...`);

      const audioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )({ sampleRate: 16000 });
      audioCtx.resume();
      audioContextRef.current = audioCtx;

      const ws = new WebSocket(url);
      voiceClientRef.current = ws;

      ws.onopen = () => {
        setIsVoiceActive(true);
        addLog("Voice Chat Connected! Speak now...");
        // Small delay to allow stream stabilization
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "bidi_text_input",
                text: "Hello, I am testing the microphone now.",
              }),
            );
          }
        }, 500);
      };

      ws.onmessage = async (e) => {
        const data = JSON.parse(e.data);

        if (data.type === "bidi_audio_stream") {
          audioQueueRef.current.push(data.audio);
          processAudioQueue();
        } else if (data.type === "bidi_transcript_stream") {
          setVoiceTranscript((prev) => prev + " " + (data.text || ""));
        } else if (data.type === "tool_use_stream") {
          addLog(`🔧 Tool: ${data.current_tool_use?.name || "unknown"}`);
        } else if (data.type === "tool_result") {
          addLog(
            `✅ Tool Result: ${data.tool_result?.content?.[0]?.text || "success"}`,
          );
        } else if (data.type === "bidi_interruption") {
          addLog("🚫 [Interrupted]");
        }

        // Fallback for previous formats
        if (data.output_text)
          setVoiceTranscript((prev) => prev + " " + data.output_text);
        if (data.output_audio) {
          audioQueueRef.current.push(data.output_audio);
          processAudioQueue();
        }
        if (data.error) addLog(`Voice error: ${data.error}`);
      };

      ws.onclose = () => {
        setIsVoiceActive(false);
        addLog("Voice Chat Disconnected.");
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micName = stream.getAudioTracks()[0]?.label || "Unknown Microphone";
      addLog(`Connected to Microphone: ${micName}`);

      const source = audioCtx.createMediaStreamSource(stream);

      const workletCode = `
        class AudioRecorderProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (input && input[0]) {
              this.port.postMessage(input[0]);
            }
            return true;
          }
        }
        registerProcessor('audio-recorder', AudioRecorderProcessor);
      `;

      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);

      try {
        await audioCtx.audioWorklet.addModule(workletUrl);
        const workletNode = new AudioWorkletNode(audioCtx, "audio-recorder");

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);

        let packetCount = 0;
        workletNode.port.onmessage = (e) => {
          const input = e.data; // Float32Array

          let maxAmp = 0;
          for (let i = 0; i < input.length; i++) {
            if (Math.abs(input[i]) > maxAmp) maxAmp = Math.abs(input[i]);
          }

          packetCount++;
          if (packetCount % 20 === 0) {
            console.log(`Mic amplitude: ${maxAmp.toFixed(4)}`);
            if (maxAmp === 0) {
              addLog(`Warning: Mic is capturing pure silence (Amplitude 0.0)`);
            }
          }

          const pcm16 = floatTo16BitPCM(input);
          const b64 = arrayBufferToBase64(pcm16.buffer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "bidi_audio_input",
                audio: b64,
                format: "pcm",
                sample_rate: 16000,
                channels: 1,
              }),
            );
          }
        };

        //@ts-ignore
        ws.cleanup = () => {
          workletNode.disconnect();
          source.disconnect();
          stream.getTracks().forEach((t) => t.stop());
          URL.revokeObjectURL(workletUrl);
        };
      } catch (err) {
        addLog(`Worklet Error: ${err}`);
        // Fallback to ScriptProcessor if Worklet absolutely fails
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(audioCtx.destination);
        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const pcm16 = floatTo16BitPCM(input);
          const b64 = arrayBufferToBase64(pcm16.buffer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "bidi_audio_input",
                audio: b64,
                format: "pcm",
                sample_rate: 16000,
                channels: 1,
              }),
            );
          }
        };
        //@ts-ignore
        ws.cleanup = () => {
          processor.disconnect();
          source.disconnect();
          stream.getTracks().forEach((t) => t.stop());
        };
      }
    } catch (err: any) {
      addLog(
        `Failed to start voice chat: ${err.message || JSON.stringify(err)}`,
      );
    }
  };

  const stopVoiceChat = () => {
    if (voiceClientRef.current) {
      if (voiceClientRef.current.cleanup) voiceClientRef.current.cleanup();
      voiceClientRef.current.close();
      voiceClientRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsVoiceActive(false);
    setVoiceTranscript("");
    audioQueueRef.current = [];
  };

  const floatTo16BitPCM = (input: Float32Array) => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++)
      binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  };

  const processAudioQueue = async () => {
    if (
      isPlayingRef.current ||
      audioQueueRef.current.length === 0 ||
      !audioContextRef.current
    )
      return;

    isPlayingRef.current = true;
    const b64 = audioQueueRef.current.shift()!;
    const binary = window.atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x8000;

    const buffer = audioContextRef.current.createBuffer(
      1,
      float32.length,
      16000,
    );
    buffer.getChannelData(0).set(float32);
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      isPlayingRef.current = false;
      processAudioQueue();
    };
    source.start();
  };

  return (
    <div className="app-container">
      <header className="header">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1>Furniture AI Explorer</h1>
            <p>Real-time visual search & catalog processing testing console</p>
          </div>
          {user && (
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={{ color: "var(--text-dim)" }}>
                {user.signInDetails?.loginId || user.username}
              </span>
              <button
                onClick={signOut}
                className="btn"
                style={{
                  background: "rgba(239, 68, 68, 0.2)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="grid">
        <div className="glass-panel">
          <h2 className="section-title">
            <Search className="text-accent" /> Test Visual Search
          </h2>

          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <div className="file-input-wrapper">
              <button
                className="btn"
                style={{
                  background: "rgba(255, 255, 255, 0.1)",
                  color: "#fff",
                }}
              >
                <ImageIcon size={18} /> Choose Image
              </button>
              <input type="file" accept="image/*" onChange={handleFileChange} />
            </div>
            {selectedFile && (
              <span style={{ color: "var(--text-muted)" }}>
                {selectedFile.name}
              </span>
            )}
          </div>

          <button
            className="btn"
            onClick={startVisualSearch}
            disabled={!selectedFile || isUploading || isSearching}
            style={{ marginTop: "1rem" }}
          >
            {isUploading ? (
              "Uploading..."
            ) : isSearching ? (
              "Searching..."
            ) : (
              <>
                <UploadCloud size={18} /> Upload & Search
              </>
            )}
          </button>

          {isSearching && !isUploading && (
            <div
              style={{
                marginTop: "1rem",
                color: "#60a5fa",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <div className="spinner"></div> Waiting for AppSync
              subscription...
            </div>
          )}

          <div style={{ marginTop: "2rem" }}>
            <h3
              style={{
                marginBottom: "1rem",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: "0.5rem",
              }}
            >
              Search Results
            </h3>
            {results.length === 0 && !isSearching ? (
              <p style={{ color: "var(--text-muted)" }}>
                No results yet. Upload an image to test.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  maxHeight: "400px",
                  overflowY: "auto",
                }}
              >
                {results.map((r, i) => (
                  <div key={i} className="product-card">
                    <div className="product-image">
                      <PresignedImage uri={r.image_uri} alt={r.productName} />
                    </div>
                    <div className="product-info">
                      <h3>{r.productName || "Unknown Product"}</h3>
                      <p>
                        {r.category} {r.subCategory ? `> ${r.subCategory}` : ""}
                      </p>
                      {r.price && (
                        <div className="price-tag">
                          ${parseFloat(r.price).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {/* Manual Subscription Test */}
          <div className="glass-panel">
            <h2 className="section-title">
              <Send className="text-accent" /> Test Subscription directly
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "0.9rem",
                marginBottom: "1rem",
              }}
            >
              Manually subscribes to a request ID and pushes a dummy object
              immediately to test realtime flow end-to-end bypassing AWS
              Bedrock.
            </p>

            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
              <input
                value={pushRequestId}
                onChange={(e) => setPushRequestId(e.target.value)}
                placeholder="Request ID"
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  borderRadius: "0.25rem",
                  border: "none",
                  outline: "none",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                }}
              />
              <input
                value={pushProductName}
                onChange={(e) => setPushProductName(e.target.value)}
                placeholder="Product Name"
                style={{
                  flex: 1,
                  padding: "0.5rem",
                  borderRadius: "0.25rem",
                  border: "none",
                  outline: "none",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                }}
              />
            </div>

            <button className="btn" onClick={manualSubscribeAndPush}>
              <Send size={18} /> Run Manual Push Test
            </button>
          </div>

          <div className="glass-panel">
            <h2 className="section-title">
              <Play className="text-accent" /> Control Panel
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "0.9rem",
                marginBottom: "1rem",
              }}
            >
              Trigger the backend state machine to parallel process all images
              currently parked in the S3 catalog/ folder.
            </p>
            <button className="btn" onClick={triggerCatalogProcessing}>
              <Play size={18} /> Trigger Catalog Processing
            </button>
          </div>

          <div className="glass-panel">
            <h2 className="section-title">
              <Send className="text-secondary" /> Furniture AI Assistant
            </h2>
            <div className="chat-container">
              <div className="messages-area">
                {messages.map((msg, i) => (
                  <div key={i} className={`message ${msg.role}`}>
                    <div className="message-sender">
                      {msg.role === "user" ? "You" : "Agent"}
                    </div>
                    {msg.text}
                  </div>
                ))}
                {isAgentLoading && (
                  <div className="message ai">
                    <div className="message-sender">Agent</div>
                    <div
                      className="spinner"
                      style={{ display: "inline-block" }}
                    ></div>{" "}
                    Thinking...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="chat-input-wrapper">
                <input
                  type="text"
                  placeholder="Ask about products, orders, or payments..."
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && invokeAgent()}
                />
                <button
                  onClick={invokeAgent}
                  disabled={isAgentLoading || !agentPrompt.trim()}
                >
                  {isAgentLoading ? "Thinking..." : "Send"}
                </button>
              </div>
            </div>

            <div
              className="voice-control-panel"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                padding: "1rem",
                background: "rgba(59, 130, 246, 0.1)",
                borderRadius: "0.5rem",
                border: "1px solid rgba(59, 130, 246, 0.2)",
                marginTop: "1rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <Volume2
                    size={20}
                    className={
                      isVoiceActive ? "text-accent animate-pulse" : "text-muted"
                    }
                  />
                  <span style={{ fontWeight: 600 }}>
                    Bidirectional Voice Chat
                  </span>
                </div>
                <button
                  className={`btn ${isVoiceActive ? "btn-danger" : "btn-primary"}`}
                  onClick={isVoiceActive ? stopVoiceChat : startVoiceChat}
                  style={{
                    margin: 0,
                    padding: "0.5rem 1rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  {isVoiceActive ? (
                    <>
                      <MicOff size={18} /> Stop Voice
                    </>
                  ) : (
                    <>
                      <Mic size={18} /> Start Voice Chat
                    </>
                  )}
                </button>
              </div>

              {isVoiceActive && (
                <div
                  className="voice-status"
                  style={{
                    fontSize: "0.85rem",
                    color: "#60a5fa",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <div className="pulse-indicator"></div> Listening &
                  Streaming...
                </div>
              )}

              {voiceTranscript && (
                <div
                  className="voice-transcript"
                  style={{
                    padding: "0.75rem",
                    background: "rgba(0,0,0,0.2)",
                    borderRadius: "0.25rem",
                    fontSize: "0.9rem",
                    color: "#e2e8f0",
                    borderLeft: "3px solid #60a5fa",
                  }}
                >
                  <strong>Agent:</strong> {voiceTranscript}
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel" style={{ flexGrow: 1 }}>
            <h2 className="section-title" style={{ marginBottom: "1rem" }}>
              Application Logs
            </h2>
            <div className="log-box">
              {logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">{log.split(" ")[0]}</span>
                  {log.substring(log.indexOf(" ") + 1)}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
            <button
              className="btn"
              onClick={() => setLogs([])}
              style={{
                marginTop: "1rem",
                background: "rgba(255,255,255,0.1)",
                width: "fit-content",
                padding: "0.5rem 1rem",
                fontSize: "0.85rem",
              }}
            >
              Clear Logs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withAuthenticator(App);
