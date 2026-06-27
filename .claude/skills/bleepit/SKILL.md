---
name: bleepit
description: Censor (bleep) words in a video or audio file with a beep tone. Use when the user wants to bleep out specific words, censor swearing/profanity, or mute/beep words in a video — either by naming exact words or by choosing a profanity severity level. Triggers on "/bleepit", "bleep out <word>", "censor the swearing in this video", "beep over the curse words", and similar.
---

# bleepit

Censor words in a video/audio file: transcribe with Whisper (word-level
timestamps), find the target words, mute the original audio under each one, and
overlay a beep tone. The video stream is copied losslessly; only audio is
re-encoded.

## When to use
- "Bleep out the word X from this video"
- "Censor the swearing / curse words in this clip"
- "Beep over every time they say X"

## Requirements
`ffmpeg`, `ffprobe`, and `openai-whisper` (the `whisper` CLI) on PATH.
Install: `brew install ffmpeg` and `pip install -U openai-whisper`.

## How to run
The script lives next to this file. Always show what it found before/while
rendering — it prints every word + timestamp it bleeps.

```bash
# Bleep specific words (poop is just an example — pass whatever they ask for)
python3 bleepit.py INPUT.mov --words "poop,heck"

# Bleep profanity by tier (cumulative): strong < standard < strict/all
python3 bleepit.py INPUT.mov --level standard      # default if nothing given

# Combine a tier with extra custom words, custom output path
python3 bleepit.py INPUT.mov --level strong --words "frick" -o clean.mov

# Preview only — list what would be bleeped, render nothing
python3 bleepit.py INPUT.mov --words poop --dry-run

# Show the built-in word tiers
python3 bleepit.py --list
```

### Useful flags
- `--level {strong|standard|strict|all}` built-in profanity tiers (cumulative).
- `--words "a,b,c"` exact words (case-insensitive; simple plurals matched too).
- `--model base.en` Whisper model; use `small.en`/`medium.en` for better
  accuracy on hard audio, `tiny.en` for speed.
- `--tone 1000` beep frequency (Hz); `--gain 0.35` beep volume (0–1).
- `--pad 0.06` seconds added to each side of a matched word.
- `--dry-run` find words but don't render. `--list` print the tiers.

## Notes
- Whisper occasionally stretches a word's end timestamp across a following
  pause; the `--pad`/merge logic keeps the bleep covering the word. If a bleep
  is too long/short, nudge `--pad` or re-run with a larger `--model`.
- Slurs are intentionally NOT in the built-in tiers — pass them via `--words`.
- "poop" is **not** a default censored word; it's only an example. Defaults
  target real profanity via `--level`.

## Browser version
A zero-install, client-side web version (ffmpeg.wasm + in-browser Whisper) lives
in `docs/` of this repo and is hosted on GitHub Pages — share that link with
anyone on any OS who doesn't have Python/ffmpeg. See the repo README.
