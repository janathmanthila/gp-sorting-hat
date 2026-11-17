"""House-name pronunciation clips for the Chatterbox shoutsplit (lead-in, 0.8 s pause, name).

  pronounce.py gen --prompt /ref/george_deep.wav --takes lead,draco-v1,...   voice raw takes to /out/raw/<id>.wav
  pronounce.py assemble                                                       join lead + each name take, old-hat filter -> /out/<id>.mp3

Every take is seeded with torch.manual_seed(SEED) right before generating, so a re-run gives the same audio.
The lead-in is voiced once and reused for every variant, so only the name differs between clips.
"""
import argparse
import glob
import json
import os
import subprocess
import tempfile
import time

import numpy as np
import soundfile as sf

SEED = 7
DRAMA = dict(exaggeration=0.8, cfg_weight=0.3)
SPLIT_PAUSE = 0.8
LEAD = "No doubt about it..."
HOUSES = {
    "orion": ("Orion", "Oh-rye-un"),
    "aquila": ("Aquila", "Ack-will-uh"),
    "cygnus": ("Cygnus", "Sig-nus"),
    "draco": ("Draco", "Dray-ko"),
}
TAKES = {"lead": LEAD}
for h, (name, resp) in HOUSES.items():
    TAKES[f"{h}-v1"] = f"{name}!"
    TAKES[f"{h}-v2"] = f"{resp}!"
    TAKES[f"{h}-v3"] = f"It's {name}!"
    TAKES[f"{h}-v4"] = f"It's {resp}!"

# Same old-hat filter as trial.py / voice/voice.py, with the shout boost.
FX = "asetrate={sr}*0.92,aresample={sr},highpass=f=70,aecho=0.8:0.6:45|90:0.22|0.12,acompressor=threshold=-18dB:ratio=3,volume=1.6,alimiter=limit=0.95"


def gen(a):
    import torch
    threads = int(os.environ.get("TORCH_THREADS", "0") or 0)
    if threads:
        torch.set_num_threads(threads)
    from chatterbox.tts import ChatterboxTTS
    t0 = time.time()
    model = ChatterboxTTS.from_pretrained(device="cpu")
    print(json.dumps({"load_s": round(time.time() - t0, 1), "sr": model.sr}), flush=True)
    raw = os.path.join(a.out, "raw")
    os.makedirs(raw, exist_ok=True)
    for tid in a.takes.split(","):
        text = TAKES[tid]
        t = time.time()
        torch.manual_seed(SEED)
        wav = model.generate(text, audio_prompt_path=a.prompt, **DRAMA).squeeze().cpu().numpy().astype(np.float32)
        sf.write(os.path.join(raw, tid + ".wav"), wav, model.sr)
        print(json.dumps({"take": tid, "text": text, "seed": SEED, "gen_s": round(time.time() - t, 1),
                          "audio_s": round(len(wav) / model.sr, 2), "rms": round(float(np.sqrt(np.mean(wav ** 2))), 4),
                          "peak": round(float(np.abs(wav).max()), 3)}), flush=True)


def assemble(a):
    raw = os.path.join(a.out, "raw")
    lead, sr = sf.read(os.path.join(raw, "lead.wav"), dtype="float32")
    lines = []
    for path in sorted(glob.glob(os.path.join(raw, "*-v*.wav"))):
        tid = os.path.basename(path)[:-4]
        name, sr2 = sf.read(path, dtype="float32")
        assert sr2 == sr
        x = np.concatenate([lead, np.zeros(int(SPLIT_PAUSE * sr), np.float32), name])
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            sf.write(f.name, x, sr)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f.name, "-af", FX.format(sr=sr),
                            "-codec:a", "libmp3lame", "-q:a", "2", os.path.join(a.out, tid + ".mp3")], check=True)
        lines.append(f"{tid}.mp3\t\"{LEAD}\" + {SPLIT_PAUSE}s + \"{TAKES[tid]}\"\tname take {len(name) / sr:.2f}s")
        print(lines[-1], flush=True)
    with open(os.path.join(a.out, "index.txt"), "w") as f:
        f.write(f"Chatterbox 0.1.7, ref george_deep.wav, exaggeration 0.8 / cfg_weight 0.3, torch.manual_seed({SEED}) per take.\n"
                f"Lead-in voiced once ({len(lead) / sr:.2f}s) and reused; old-hat filter + shout boost applied.\n\n")
        f.write("\n".join(lines) + "\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["gen", "assemble"])
    p.add_argument("--prompt")
    p.add_argument("--out", default="/out")
    p.add_argument("--takes", default=",".join(TAKES))
    a = p.parse_args()
    gen(a) if a.mode == "gen" else assemble(a)


if __name__ == "__main__":
    main()
