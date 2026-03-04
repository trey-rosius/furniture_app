FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app
COPY . .
RUN python -m pip install --no-cache-dir -r requirements.txt
ENV AWS_REGION=us-east-1
EXPOSE 8000
CMD ["python", "stripe_proxy.py"]
