"""TRIAL ONLY: can Chatterbox Turbo replace the standard Chatterbox hat voice? (production voice.py is untouched)

Voices Thilini's intro, ponder and shout with the same reference clip, seed 7 per take, old-hat filter and shout
split as voice.py, then joins each variant into one ceremony file.

  turbo_trial.py --variants S          standard model, production settings (exaggeration 1.1, cfg 0.25)
  turbo_trial.py --variants T1,T2,T3,T4   Turbo: defaults / temperature 1.0 / [chuckle] tag / [dramatic] tag
  turbo_trial.py --probe               check which Turbo knobs change the output, list the paralinguistic tags
  turbo_trial.py --join S,T1,...       join intro + 1.2 s + ponder + 2.6 s + shout into thilini-<V>.mp3
Prints one JSON line per clip (gen_s excludes model load, which is printed separately).
"""
import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

REF = "/app/ref/hat.wav"
SEED = 7
SPLIT_PAUSE = 0.8
PITCH = 0.92  # same old-hat filter as voice.py
FX = f"asetrate={{sr}}*{PITCH},aresample={{sr}},highpass=f=70,aecho=0.8:0.6:45|90:0.22|0.12,acompressor=threshold=-18dB:ratio=3"
SHOUT_FX = ",volume=1.6,alimiter=limit=0.95"

INTRO = "Ah, Thilini! Alicia Insurance, and a cricket field where you shine... a steady eye and a heart that loves the chase."
PONDER = "Such nerve, such spark... and a drive that never tires of the chase. Yes, I see it clearly."
SHOUT = [("Better be...", SPLIT_PAUSE), ("It's Orion!", 0.0)]

LINES = {
    "S": {"intro": INTRO, "ponder": PONDER},
    "T1": {"intro": INTRO, "ponder": PONDER},
    "T2": {"intro": INTRO, "ponder": PONDER},
    "T3": {"intro": "Ah, Thilini! [chuckle] Alicia Insurance, and a cricket field where you shine... a steady eye and a heart that loves the chase.",
           "ponder": PONDER},
    # bonus: the tokenizer also has style tags ([dramatic], [angry], [whispering] ...); [dramatic] before every take
    "T4": {"intro": "[dramatic] " + INTRO, "ponder": "[dramatic] " + PONDER},
}
TAKE_PREFIX = {"T4": "[dramatic] "}
KWARGS = {
    "S": dict(exaggeration=1.1, cfg_weight=0.25),
    "T1": {},
    "T2": dict(temperature=1.0),
    "T3": {},
    "T4": {},
}


def load(kind):
    t = time.time()
    if kind == "S":
        from chatterbox.tts import ChatterboxTTS
        m = ChatterboxTTS.from_pretrained(device="cpu")
    else:
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        m = ChatterboxTurboTTS.from_pretrained(device="cpu")
    print(json.dumps({"model": kind, "load_s": round(time.time() - t, 1), "threads": torch.get_num_threads()}), flush=True)
    return m


CACHE_CONDS = os.environ.get("CACHE_CONDS") == "1"  # embed the reference clip once instead of on every take


def take(model, text, **kw):
    torch.manual_seed(SEED)
    return model.generate(text, audio_prompt_path=None if CACHE_CONDS else REF, **kw).squeeze().cpu().numpy().astype(np.float32)


def stats(x, sr):
    """Voiced span and gaps from 20 ms RMS frames (raw, pre-filter)."""
    f = int(0.02 * sr)
    n = len(x) // f
    rms = np.sqrt(np.mean(x[: n * f].reshape(n, f) ** 2, axis=1)) if n else np.zeros(1)
    voiced = rms > max(0.01, rms.max() * 0.05)
    idx = np.flatnonzero(voiced)
    if not len(idx):
        return {"silent": True}
    gaps, run = [], 0
    for v in voiced[idx[0]: idx[-1] + 1]:
        run = 0 if v else run + 1
        gaps.append(run)
    return {"voiced_s": round((idx[-1] - idx[0] + 1) * 0.02, 2), "tail_quiet_s": round((n - 1 - idx[-1]) * 0.02, 2),
            "longest_gap_s": round(max(gaps) * 0.02, 2), "rms": round(float(rms.mean()), 4), "peak": round(float(np.abs(x).max()), 3)}


def to_out(samples, sr, out, shout):
    """Filtered 24 kHz mono wav (for joining) and mp3 q4 (to listen)."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.wav"
        sf.write(raw, samples, sr, subtype="FLOAT")
        af = FX.format(sr=sr) + (SHOUT_FX if shout else "")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", af, "-ac", "1", "-ar", "24000", str(out.with_suffix(".wav"))], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out.with_suffix(".wav")), "-codec:a", "libmp3lame", "-q:a", "4", str(out)], check=True)


def voice(variants, out_dir):
    kind = "S" if variants == ["S"] else "T"
    model = load(kind)
    sr = model.sr
    if CACHE_CONDS:
        t = time.time()
        model.prepare_conditionals(REF, **({"exaggeration": KWARGS["S"]["exaggeration"]} if kind == "S" else {}))
        print(json.dumps({"cache_conds_s": round(time.time() - t, 1)}), flush=True)
    for v in variants:
        for part in ("intro", "ponder", "shout"):
            takes = [(TAKE_PREFIX.get(v, "") + t, p) for t, p in SHOUT] if part == "shout" else [(LINES[v][part], 0.0)]
            t = time.time()
            chunks, take_info = [], []
            for text, pause in takes:
                tt = time.time()
                x = take(model, text, **KWARGS[v])
                take_info.append({"text": text, "gen_s": round(time.time() - tt, 1), "audio_s": round(len(x) / sr, 2), **stats(x, sr)})
                chunks.append(x)
                if pause:
                    chunks.append(np.zeros(int(pause * sr), np.float32))
            gen = time.time() - t
            samples = np.concatenate(chunks)
            out = out_dir / f"thilini-{v}-{part}.mp3"
            to_out(samples, sr, out, part == "shout")
            text = " ".join(t for t, _ in takes)
            dur = len(samples) / sr / PITCH  # after the old-hat slow-down
            spoken = sum(ti["audio_s"] for ti in take_info) / PITCH
            print(json.dumps({"variant": v, "part": part, "gen_s": round(gen, 1), "audio_s": round(dur, 2), "rtf": round(gen / dur, 2),
                              "chars_per_s": round(len(text) / spoken, 1), "sha": hashlib.sha1(samples.tobytes()).hexdigest()[:10],
                              "takes": take_info}), flush=True)


def probe():
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    model = ChatterboxTurboTTS.from_pretrained(device="cpu")
    tags = sorted(t for t in model.tokenizer.get_vocab() if t.startswith("[") and t.endswith("]"))
    print(json.dumps({"bracket_tokens": tags, "hp_emotion_adv": model.t3.hp.emotion_adv}), flush=True)
    for t in ["[chuckle]", "[sigh]", "[gasp]", "[cough]", "[laugh]", "[groan]", "[sniff]", "[clear throat]", "[shush]"]:
        print(json.dumps({"tag": t, "tokens": model.tokenizer.tokenize(t)}), flush=True)
    text = "Better be..."
    base = take(model, text)
    for name, kw in [("same", {}), ("exaggeration=1.1", dict(exaggeration=1.1)), ("exaggeration=2.0", dict(exaggeration=2.0)),
                     ("cfg_weight=0.5", dict(cfg_weight=0.5)), ("temperature=1.0", dict(temperature=1.0)),
                     ("temperature=0.9", dict(temperature=0.9)), ("top_p=1.0", dict(top_p=1.0)), ("repetition_penalty=1.5", dict(repetition_penalty=1.5))]:
        x = take(model, text, **kw)
        same = len(x) == len(base) and bool(np.allclose(x, base, atol=1e-4))
        print(json.dumps({"knob": name, "identical_to_default": same, "audio_s": round(len(x) / model.sr, 2)}), flush=True)


def join(variants, out_dir):
    for v in variants:
        parts = [out_dir / f"thilini-{v}-{p}.wav" for p in ("intro", "ponder", "shout")]
        flt = ("[0]aformat=sample_rates=24000:channel_layouts=mono,apad=pad_dur=1.2[a];[1]aformat=sample_rates=24000:channel_layouts=mono,apad=pad_dur=2.6[b];"
               "[2]aformat=sample_rates=24000:channel_layouts=mono[c];[a][b][c]concat=n=3:v=0:a=1[o]")
        out = out_dir / f"thilini-{v}.mp3"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *sum([["-i", str(p)] for p in parts], []), "-filter_complex", flt, "-map", "[o]",
                        "-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame", "-q:a", "4", str(out)], check=True)
        d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout.strip()
        print(json.dumps({"joined": out.name, "duration_s": float(d)}), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--variants")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--join")
    p.add_argument("--out", default="/out")
    a = p.parse_args()
    torch.set_num_threads(int(os.environ.get("TORCH_THREADS") or 4))
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if a.probe:
        probe()
    if a.variants:
        voice(a.variants.split(","), out_dir)
    if a.join:
        join(a.join.split(","), out_dir)


if __name__ == "__main__":
    main()
