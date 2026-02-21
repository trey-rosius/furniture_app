FROM public.ecr.aws/docker/library/python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The BedrockAgentCoreApp handles the server setup
EXPOSE 8080

CMD ["python", "agent_runtime.py"]
