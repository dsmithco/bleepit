# bleepit

Bleep words out of a video. It transcribes the audio, finds the words you want
gone, mutes the original under each one, and drops a beep tone on top. The video
stream is copied untouched — only the audio is re-encoded.

There are **two ways to use it**:

| | Best for | Needs |
|---|---|---|
| **🌐 Web app** | Sharing with anyone, any OS | Just a browser |
| **⌨️ Claude Code skill** | Power users, batch/CLI work | Claude Code + ffmpeg + whisper |

---

## 🌐 Web app (no install, any OS)

**→ https://dsmithco.github.io/bleepit/**

Open the link, drop in a video, type the words (or pick a profanity level), hit
**Bleep it**, download the result. Everything runs **in your browser** —
ffmpeg compiled to WebAssembly plus an in-browser Whisper speech model. Your
video is never uploaded anywhere.

- No Python, no install, works on Mac / Windows / Linux / Chromebook.
- First run downloads a ~150 MB speech model (cached after that).
- Works best in **Chrome or Edge** (uses WebGPU for speed; falls back to slower
  CPU elsewhere). Best for short clips — very large files can exhaust browser memory.

Just share the link with someone — that's the whole "install."

---

## ⌨️ Claude Code skill

`bleepit` is packaged as a [Claude Code](https://code.claude.com/docs/en/overview)
skill. Once it's in your skills folder, you can just say *"bleep out the word X
from this video"* (or `/bleepit`) and Claude runs it.

### 1. Run Claude Code

You drive the skill from **Claude Code**, either in a terminal or inside VS Code:

- **Terminal** — install and run from the command line:
  - Install (macOS / Linux / WSL): `curl -fsSL https://claude.ai/install.sh | bash`
    (Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`)
  - Then `cd` into a project and run `claude`.
  - Docs: [Set up Claude Code](https://code.claude.com/docs/en/setup) ·
    [Quickstart](https://code.claude.com/docs/en/quickstart)
- **VS Code extension** — inline diffs and chat in your editor:
  - Open the Extensions view (`Cmd/Ctrl+Shift+X`), search **"Claude Code"**,
    install it, then open the Command Palette and choose **Claude Code: Open in New Tab**.
  - Direct install link: `vscode:extension/anthropic.claude-code`
  - Docs: [Claude Code in VS Code](https://code.claude.com/docs/en/vs-code)

### 2. Install the skill

Copy the skill folder into your Claude Code skills directory:

```bash
# project-level (this repo) — already at .claude/skills/bleepit
# or make it available everywhere:
cp -r .claude/skills/bleepit ~/.claude/skills/bleepit
```

More on skills: [Claude Code skills docs](https://code.claude.com/docs/en/skills).

### 3. Requirements (for the skill / CLI)

The skill shells out to `ffmpeg` and OpenAI Whisper:

```bash
brew install ffmpeg            # or apt-get install ffmpeg
pip install -U openai-whisper  # provides the `whisper` command
```

### 4. Use it

Ask Claude in plain language (*"bleep out every swear in clip.mov"*), or run the
script directly:

```bash
cd .claude/skills/bleepit

# Specific words (poop is just an example, not a default)
python3 bleepit.py clip.mov --words "poop,heck"

# Profanity by tier (cumulative): strong < standard < strict/all
python3 bleepit.py clip.mov --level standard      # default if nothing given

# Tier + extra words + custom output
python3 bleepit.py clip.mov --level strong --words "frick" -o clean.mov

# Preview matches without rendering / list the tiers
python3 bleepit.py clip.mov --words poop --dry-run
python3 bleepit.py --list
```

| Flag | Meaning |
|---|---|
| `--words "a,b,c"` | Exact words to bleep (case-insensitive; simple plurals matched too) |
| `--level strong\|standard\|strict\|all` | Built-in profanity tiers (cumulative) |
| `--model base.en` | Whisper model — `small.en`/`medium.en` for accuracy, `tiny.en` for speed |
| `--tone 1000` / `--gain 0.35` | Beep frequency (Hz) / volume (0–1) |
| `--pad 0.06` | Seconds added to each side of a matched word |
| `--dry-run` / `--list` | Preview matches / print the tiers |

---

## Notes

- **"poop" is not a default censored word** — it's only an example. Defaults
  target real profanity via `--level`.
- **Slurs** are intentionally not bundled in the tiers; pass them via `--words`.
- Whisper occasionally stretches a word's end timestamp across a following
  pause. The padding/merge logic keeps the bleep over the word; nudge `--pad` or
  use a bigger `--model` if a bleep is off.

## Repo layout

```
docs/                      # the web app (served by GitHub Pages)
  index.html  app.js  coi-serviceworker.js
.claude/skills/bleepit/    # the Claude Code skill
  SKILL.md  bleepit.py
```

## License

MIT
