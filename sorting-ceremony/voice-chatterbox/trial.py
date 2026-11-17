"""Chatterbox trial: voice the three sample ceremony lines with two settings and give them the old-hat sound.

  trial.py --ref A            built-in default voice
  trial.py --ref B --prompt /ref/george.wav   clone the timbre of a (synthetic) reference clip
Writes cb-<ref>-<mild|drama>-<intro|ponder|shout>.mp3 (+ -nofilter shouts and a "Draco!" variant) to --out
and prints one JSON line of timings per clip.
"""
import argparse
import json
import os
import subprocess
import tempfile
import time

import numpy as np
import torch

LINES = {
    "intro": "Well, well, Hamza of DHV! Trivia, cricket and pool, all in your repertoire... a curious, clever mind that loves to plan its next move.",
    "ponder": "A sharp mind, a careful eye... and a heart that guards what matters most. How very wise.",
    "shout": "No doubt about it... DRACO!",
}
EXTRA = {"shoutcap": "No doubt about it... Draco!"}  # in case all caps gets spelled out
# The shout voiced in two takes and joined with a held pause, like voice/voice.py does with Kokoro.
SPLIT = {"shoutsplit": ("No doubt about it...", "DRACO!")}
SPLIT_PAUSE = 0.8
SETTINGS = {"mild": dict(exaggeration=0.5, cfg_weight=0.5), "drama": dict(exaggeration=0.8, cfg_weight=0.3)}

# Same filter as voice/voice.py, so the comparison with Kokoro is fair.
FX = "asetrate={sr}*0.92,aresample={sr},highpass=f=70,aecho=0.8:0.6:45|90:0.22|0.12,acompressor=threshold=-18dB:ratio=3"
SHOUT_FX = ",volume=1.6,alimiter=limit=0.95"


def to_mp3(wav_path, mp3_path, sr, shout, filtered=True):
    af = ["-af", FX.format(sr=sr) + (SHOUT_FX if shout else "")] if filtered else []
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav_path, *af, "-codec:a", "libmp3lame", "-q:a", "2", mp3_path], check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ref", required=True)
    p.add_argument("--prompt")
    p.add_argument("--out", default="/out")
    p.add_argument("--settings", default="mild,drama")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--lines", default="intro,ponder,shout,shoutcap,shoutsplit")
    a = p.parse_args()

    threads = int(os.environ.get("TORCH_THREADS", "0") or 0)
    if threads:
        torch.set_num_threads(threads)
    print(json.dumps({"torch": torch.__version__, "threads": torch.get_num_threads(), "interop": torch.get_num_interop_threads()}), flush=True)

    from chatterbox.tts import ChatterboxTTS
    t0 = time.time()
    model = ChatterboxTTS.from_pretrained(device="cpu")
    print(json.dumps({"load_s": round(time.time() - t0, 1), "sr": model.sr}), flush=True)

    lines = dict(LINES, **EXTRA, **SPLIT)
    wanted = a.lines.split(",")
    for sname in a.settings.split(","):
        for kind, text in lines.items():
            if kind not in wanted or (kind in ("shoutcap", "shoutsplit") and sname != "drama"):
                continue
            parts = text if isinstance(text, tuple) else (text,)
            t = time.time()
            chunks = []
            for i, part in enumerate(parts):
                torch.manual_seed(a.seed)
                wav = model.generate(part, audio_prompt_path=a.prompt, **SETTINGS[sname])
                if i:
                    chunks.append(np.zeros(int(SPLIT_PAUSE * model.sr), np.float32))
                chunks.append(wav.squeeze().cpu().numpy().astype(np.float32))
            gen = time.time() - t
            x = np.concatenate(chunks)
            text = " ".join(parts)
            dur = len(x) / model.sr
            base = f"cb-{a.ref}-{sname}-{kind}"
            with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                import soundfile as sf
                sf.write(f.name, x, model.sr)
                shout = kind.startswith("shout")
                to_mp3(f.name, os.path.join(a.out, base + ".mp3"), model.sr, shout)
                if shout:
                    to_mp3(f.name, os.path.join(a.out, base + "-nofilter.mp3"), model.sr, shout, filtered=False)
            print(json.dumps({
                "file": base, "gen_s": round(gen, 1), "audio_s": round(dur, 2), "rtf": round(gen / dur, 2),
                "chars_per_s": round(len(text) / dur, 1), "rms": round(float(np.sqrt(np.mean(x ** 2))), 4),
                "peak": round(float(np.abs(x).max()), 3),
            }), flush=True)


if __name__ == "__main__":
    main()
