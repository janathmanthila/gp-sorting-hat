# Chatterbox TTS (Resemble AI, MIT) on CPU: the Turbo model (the default hat, ~3x faster) and the standard model
# (slower, with a drama setting), the hat's reference voice, and ffmpeg for the old-hat filter. A one-shot job,
# like the Kokoro image.
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# CPU-only torch first (the package pins torch/torchaudio 2.6.0), then the package itself pinned.
RUN pip install --no-cache-dir torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir chatterbox-tts==0.1.7

# Weights live in a world-readable cache so the container can run as any uid; runs are offline.
ENV HF_HOME=/opt/hf HOME=/tmp TORCH_HOME=/opt/torch
RUN python -c "from chatterbox.tts import ChatterboxTTS; ChatterboxTTS.from_pretrained(device='cpu')" \
 && chmod -R a+rX /opt/hf
# chmod only what this download added: a blanket chmod -R would copy the 3 GB standard weights into this layer.
RUN touch /tmp/stamp \
 && python -c "from chatterbox.tts_turbo import ChatterboxTurboTTS; ChatterboxTurboTTS.from_pretrained(device='cpu')" \
 && find /opt/hf -newer /tmp/stamp -exec chmod a+rX {} + && rm /tmp/stamp
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1

WORKDIR /app
COPY ref/hat.wav ref/hat.wav
COPY voice.py .
ENTRYPOINT ["python", "-u", "voice.py"]
