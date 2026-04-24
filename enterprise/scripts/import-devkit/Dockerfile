FROM python:3.11-alpine

RUN pip install --no-cache-dir requests==2.32.3 pyyaml==6.0.1

WORKDIR /app

COPY import-devkit.py .

CMD ["python3", "import-devkit.py"]