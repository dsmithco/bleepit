#!/usr/bin/env python3
"""bleepit — censor words in a video/audio file with a beep tone.

Transcribes the audio with Whisper (word-level timestamps), finds the words to
censor (either an explicit --words list or a built-in profanity --level), then
mutes the original audio under each match and overlays a censor tone.

Requirements: ffmpeg, ffprobe, and openai-whisper (`whisper` on PATH).

Examples:
  bleepit.py clip.mov --words poop
  bleepit.py clip.mov --level strong
  bleepit.py clip.mov --level standard --words "frick,heck" -o clean.mov
  bleepit.py clip.mov --words damn --dry-run
  bleepit.py --list
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# Built-in profanity tiers (cumulative). Slurs are intentionally NOT bundled;
# pass them via --words if you need to censor something specific.
MILD = {
    "damn", "damned", "damnit", "dammit", "goddamn", "goddamned", "goddamnit",
    "hell", "crap", "crappy", "ass", "asses", "arse", "piss", "pissed", "pissing",
}
MODERATE = {
    "shit", "shits", "shitty", "shitting", "bullshit", "bitch", "bitches",
    "bitching", "bastard", "bastards", "dick", "dicks", "dickhead", "douche",
    "douchebag", "prick", "pricks", "asshole", "assholes", "jackass", "slut", "whore",
}
STRONG = {
    "fuck", "fucks", "fucked", "fucking", "fucker", "fuckers", "fuckin",
    "motherfucker", "motherfuckers", "motherfucking", "clusterfuck",
    "cunt", "cunts", "cocksucker", "cocksuckers",
}

LEVELS = {
    "strong": STRONG,
    "standard": STRONG | MODERATE,
    "strict": STRONG | MODERATE | MILD,
    "all": STRONG | MODERATE | MILD,
}


def run(cmd, **kw):
    return subprocess.run(cmd, **kw)


def norm(token: str) -> str:
    return re.sub(r"[^a-z0-9]", "", token.lower())


def probe(path):
    """Return (duration_seconds, has_video, audio_channels)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,channels",
         "-of", "json", path],
        capture_output=True, text=True,
    )
    data = json.loads(out.stdout or "{}")
    dur = float(data.get("format", {}).get("duration", 0.0))
    has_video = False
    channels = 2
    for s in data.get("streams", []):
        if s.get("codec_type") == "video":
            has_video = True
        if s.get("codec_type") == "audio" and s.get("channels"):
            channels = int(s["channels"])
    return dur, has_video, channels


def transcribe(audio_path, model, tmpdir):
    cmd = [
        "whisper", audio_path,
        "--model", model,
        "--language", "en",
        "--task", "transcribe",
        "--word_timestamps", "True",
        "--fp16", "False",
        "--output_format", "json",
        "--output_dir", tmpdir,
        "--verbose", "False",
    ]
    res = run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stderr[-2000:] + "\n")
        sys.exit("whisper failed (is openai-whisper installed?)")
    base = os.path.splitext(os.path.basename(audio_path))[0]
    jpath = os.path.join(tmpdir, base + ".json")
    with open(jpath) as f:
        data = json.load(f)
    words = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []):
            words.append((w["start"], w["end"], w["word"]))
    return data.get("text", "").strip(), words


def build_targets(level, extra_words):
    targets = set(LEVELS[level]) if level else set()
    for w in extra_words:
        w = norm(w)
        if w:
            targets.add(w)
            targets.add(w + "s")  # friendly plural for custom words
    return targets


def merge(intervals, gap=0.0):
    intervals = sorted(intervals)
    merged = []
    for a, b in intervals:
        if merged and a <= merged[-1][1] + gap:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def main():
    ap = argparse.ArgumentParser(
        description="Bleep (censor) words in a video/audio file.")
    ap.add_argument("input", nargs="?", help="input video/audio file")
    ap.add_argument("-o", "--output", help="output file (default: <name>_bleeped.<ext>)")
    ap.add_argument("--words", default="",
                    help="comma-separated exact words to bleep (case-insensitive)")
    ap.add_argument("--level", choices=list(LEVELS),
                    help="built-in profanity tier: strong < standard < strict/all")
    ap.add_argument("--model", default="base.en",
                    help="whisper model (tiny.en, base.en, small.en, medium.en...)")
    ap.add_argument("--tone", type=float, default=1000.0, help="beep frequency Hz")
    ap.add_argument("--gain", type=float, default=0.35, help="beep volume 0-1")
    ap.add_argument("--pad", type=float, default=0.06,
                    help="seconds of padding added to each side of a word")
    ap.add_argument("--dry-run", action="store_true",
                    help="only print what would be bleeped; do not render")
    ap.add_argument("--list", action="store_true",
                    help="print the built-in word tiers and exit")
    args = ap.parse_args()

    if args.list:
        for name in ("strong", "standard", "strict"):
            print(f"[{name}] " + ", ".join(sorted(LEVELS[name])))
        return

    if not args.input:
        ap.error("input file required")
    for tool in ("ffmpeg", "ffprobe", "whisper"):
        if not shutil.which(tool):
            sys.exit(f"required tool not found on PATH: {tool}")
    if not os.path.exists(args.input):
        sys.exit(f"no such file: {args.input}")

    extra = [w for w in args.words.split(",") if w.strip()]
    level = args.level
    if not level and not extra:
        level = "standard"  # sensible default when nothing is specified
    targets = build_targets(level, extra)
    if not targets:
        sys.exit("nothing to bleep: pass --words and/or --level")

    dur, has_video, channels = probe(args.input)

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")
        run(["ffmpeg", "-y", "-i", args.input, "-vn", "-ac", "1",
             "-ar", "16000", "-c:a", "pcm_s16le", wav],
            capture_output=True, text=True)

        print(f"Transcribing with whisper '{args.model}' ...", file=sys.stderr)
        text, words = transcribe(wav, args.model, tmp)
        print("Transcript: " + text, file=sys.stderr)

        hits = [(s, e, w) for (s, e, w) in words if norm(w) in targets]
        if not hits:
            print("No target words found — nothing to bleep.")
            tlabel = ("level=" + level) if level else ""
            print(f"  (looking for: {', '.join(sorted(targets))}) {tlabel}")
            return

        print(f"Bleeping {len(hits)} word(s):")
        for s, e, w in hits:
            print(f"  {s:6.2f}-{e:6.2f}  {w.strip()!r}")

        intervals = [[max(0.0, s - args.pad), min(dur, e + args.pad)]
                     for s, e, _ in hits]
        intervals = merge(intervals, gap=0.04)

        if args.dry_run:
            print("(dry run — no file written)")
            return

        out = args.output
        if not out:
            stem, ext = os.path.splitext(args.input)
            out = f"{stem}_bleeped{ext}"

        gate = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in intervals)
        pan = "pan=mono|c0=c0" if channels == 1 else "pan=stereo|c0=c0|c1=c0"
        d = dur + 1.0
        fc = (
            f"[0:a]volume='1-({gate})':eval=frame[voice];"
            f"sine=f={args.tone}:r=48000:d={d:.2f},{pan},"
            f"volume='{args.gain}*({gate})':eval=frame[tone];"
            f"[voice][tone]amix=inputs=2:duration=first:normalize=0[aout]"
        )

        ext = os.path.splitext(out)[1].lower()
        acodec = ["-c:a", "pcm_s16le"] if ext == ".wav" else ["-c:a", "aac", "-b:a", "256k"]
        cmd = ["ffmpeg", "-y", "-i", args.input, "-filter_complex", fc]
        if has_video:
            cmd += ["-map", "0:v", "-map", "[aout]", "-c:v", "copy",
                    "-movflags", "+faststart"]
        else:
            cmd += ["-map", "[aout]"]
        cmd += acodec + [out]

        res = run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            sys.stderr.write(res.stderr[-2000:] + "\n")
            sys.exit("ffmpeg render failed")
        print(f"\nWrote: {out}")


if __name__ == "__main__":
    main()
