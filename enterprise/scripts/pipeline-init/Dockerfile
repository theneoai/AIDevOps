FROM python:3.11-alpine

# Install requests (only runtime dep needed)
RUN pip install --no-cache-dir requests==2.32.3

WORKDIR /app

COPY register-pipeline.py .

CMD ["python3", "register-pipeline.py"]
