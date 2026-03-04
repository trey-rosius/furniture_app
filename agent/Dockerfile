FROM public.ecr.aws/docker/library/python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    portaudio19-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy entire project
COPY . .

# Install dependencies
RUN python -m pip install --no-cache-dir -r requirements.txt

# Set AWS region environment variable
ENV AWS_REGION=us-east-1
ENV AWS_DEFAULT_REGION=us-east-1
ENV DOCKER_CONTAINER=1

EXPOSE 8080

CMD ["python", "agent_runtime.py"]
