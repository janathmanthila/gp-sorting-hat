# TRIAL ONLY: Chatterbox Turbo (350M) on top of the production hat image, which stays untouched.
# Adds the Turbo weights to the same world-readable HF cache; runtime stays offline.
FROM ceremony-voice-chatterbox

USER root
# chmod only what the download added: a blanket chmod -R would copy the 3 GB standard weights into this layer.
RUN touch /tmp/stamp \
 && HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python -c "from chatterbox.tts_turbo import ChatterboxTurboTTS; ChatterboxTurboTTS.from_pretrained(device='cpu')" \
 && find /opt/hf -newer /tmp/stamp -exec chmod a+rX {} + && rm /tmp/stamp
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1

COPY turbo_trial.py .
ENTRYPOINT ["python", "-u", "turbo_trial.py"]
