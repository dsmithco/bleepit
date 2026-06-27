# bleepit

A [Claude Code](https://code.claude.com/docs/en/overview) skill that bleeps
words out of a video. It transcribes the audio, finds the words you want gone,
mutes the original under each one, and drops a beep tone on top. The video
stream is copied untouched — only the audio is re-encoded.

> **Just want to click a button?** There's a no-install, runs-in-your-browser
> version at **https://graysandtech.com/sandbox/bleepit/** — drop in a video,
> type the words, download the result. No Python, any OS. This repo is the
> command-line / Claude Code skill.

---

## Use it as a Claude Code skill

Once the skill is installed, just say *"bleep out the word X from this video"*
(or `/bleepit`) and Claude runs it.

### 1. Run Claude Code

You drive the skill from **Claude Code**, in a terminal or inside VS Code:

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
# make it available in every project:
cp -r .claude/skills/bleepit ~/.claude/skills/bleepit
# …or keep it project-local at .claude/skills/bleepit
```

More on skills: [Claude Code skills docs](https://code.claude.com/docs/en/skills).

### 3. Requirements

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
.claude/skills/bleepit/
  SKILL.md      # skill definition / how Claude invokes it
  bleepit.py    # the CLI that does the work
```

The browser version lives in the Gray Sand Technology site sandbox
([graysandtech.com/sandbox/bleepit](https://graysandtech.com/sandbox/bleepit/)).

## License

MIT
