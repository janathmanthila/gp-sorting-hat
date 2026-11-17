# Kokoro text-to-speech with the model baked in, plus ffmpeg for the old-hat filter. Runs as a one-shot job.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir kokoro-onnx==0.6.1 soundfile numpy

WORKDIR /app
ARG MODEL_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
RUN curl -fsSL -o kokoro-v1.0.onnx "$MODEL_URL/kokoro-v1.0.onnx" \
 && curl -fsSL -o voices-v1.0.bin "$MODEL_URL/voices-v1.0.bin"

COPY voice.py .
ENTRYPOINT ["python", "-u", "voice.py"]
