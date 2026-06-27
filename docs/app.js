// bleepit — client-side video word censor.
// Pipeline: ffmpeg.wasm extracts 16kHz mono audio -> Whisper (in-browser via
// Transformers.js) gives word timestamps -> match target words -> ffmpeg.wasm
// mutes the original under each match and overlays a beep tone. Nothing leaves
// the browser; no server, no upload.

// Vendored locally (same-origin) because @ffmpeg/ffmpeg spawns a module Worker
// from import.meta.url — a cross-origin worker script is blocked by browsers.
import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { fetchFile, toBlobURL } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/+esm";

env.allowLocalModels = false;

// ---- Built-in profanity tiers (mirror of the Python skill, cumulative) ----
const MILD = ["damn","damned","damnit","dammit","goddamn","goddamned","goddamnit","hell","crap","crappy","ass","asses","arse","piss","pissed","pissing"];
const MODERATE = ["shit","shits","shitty","shitting","bullshit","bitch","bitches","bitching","bastard","bastards","dick","dicks","dickhead","douche","douchebag","prick","pricks","asshole","assholes","jackass","slut","whore"];
const STRONG = ["fuck","fucks","fucked","fucking","fucker","fuckers","fuckin","motherfucker","motherfuckers","motherfucking","clusterfuck","cunt","cunts","cocksucker","cocksuckers"];
const LEVELS = {
  strong: STRONG,
  standard: [...STRONG, ...MODERATE],
  strict: [...STRONG, ...MODERATE, ...MILD],
  all: [...STRONG, ...MODERATE, ...MILD],
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const drop = $("drop");
const fileInput = $("file");
const wordsInput = $("words");
const levelSel = $("level");
const goBtn = $("go");
const logEl = $("log");
const result = $("result");
const player = $("player");
const dl = $("download");
const statusEl = $("status");

let file = null;
let ffmpeg = null;
let transcriber = null;

function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(s, busy = false) {
  statusEl.textContent = s;
  goBtn.disabled = busy || !file;
  goBtn.textContent = busy ? "Working…" : "Bleep it";
}

// ---- File selection ----
function pickFile(f) {
  if (!f) return;
  file = f;
  drop.classList.add("has-file");
  $("dropmsg").textContent = `${f.name}  (${(f.size / 1e6).toFixed(1)} MB)`;
  result.hidden = true;
  setStatus("Ready.");
}
drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => pickFile(e.target.files[0]));
["dragover", "dragenter"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
drop.addEventListener("drop", (e) => pickFile(e.dataTransfer.files[0]));

// ---- Lazy loaders ----
async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  log("Loading ffmpeg.wasm…");
  ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => { if (message) console.debug(message); });
  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    workerURL: await toBlobURL(`${base}/ffmpeg-core.worker.js`, "text/javascript"),
  });
  log("ffmpeg ready.");
  return ffmpeg;
}

async function loadWhisper() {
  if (transcriber) return transcriber;
  const device = navigator.gpu ? "webgpu" : "wasm";
  log(`Loading Whisper model (device: ${device}) — first run downloads ~150MB…`);
  let last = -1;
  transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-base.en", {
    device,
    dtype: device === "webgpu" ? "fp32" : "q8",
    progress_callback: (p) => {
      if (p.status === "progress" && p.file && p.total) {
        const pct = Math.round((p.loaded / p.total) * 100);
        if (pct !== last && pct % 10 === 0) { log(`  ${p.file}: ${pct}%`); last = pct; }
      }
    },
  });
  log("Whisper ready.");
  return transcriber;
}

// ---- WAV (16-bit PCM mono) -> Float32 ----
function wavToFloat32(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 12; // skip RIFF header
  while (off + 8 <= dv.byteLength) {
    const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === "data") {
      const n = (size / 2) | 0;
      const out = new Float32Array(n);
      let p = off + 8;
      for (let i = 0; i < n; i++) { out[i] = dv.getInt16(p, true) / 32768; p += 2; }
      return out;
    }
    off += 8 + size + (size & 1);
  }
  throw new Error("WAV data chunk not found");
}

// ---- Target words + interval helpers ----
function buildTargets() {
  const set = new Set();
  const lvl = levelSel.value;
  if (lvl && LEVELS[lvl]) LEVELS[lvl].forEach((w) => set.add(w));
  wordsInput.value.split(",").map((w) => norm(w)).filter(Boolean).forEach((w) => {
    set.add(w); set.add(w + "s");
  });
  return set;
}
function mergeIntervals(iv, gap = 0.04) {
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// ---- Main ----
goBtn.addEventListener("click", run);

async function run() {
  if (!file) return;
  const targets = buildTargets();
  if (targets.size === 0) {
    alert("Pick a profanity level or enter at least one word to bleep.");
    return;
  }
  logEl.textContent = "";
  result.hidden = true;
  setStatus("Loading engines…", true);

  try {
    const fmp = await loadFFmpeg();
    const asr = await loadWhisper();

    const inName = "input" + (file.name.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4");
    await fmp.writeFile(inName, await fetchFile(file));

    setStatus("Extracting audio…", true);
    log("Extracting 16kHz mono audio…");
    await fmp.exec(["-i", inName, "-vn", "-ac", "1", "-ar", "16000",
      "-c:a", "pcm_s16le", "-f", "wav", "speech.wav"]);
    const wav = await fmp.readFile("speech.wav");
    const pcm = wavToFloat32(wav);
    const dur = pcm.length / 16000;
    log(`Audio: ${dur.toFixed(1)}s`);

    setStatus("Transcribing…", true);
    log("Transcribing…");
    const out = await asr(pcm, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 });
    const chunks = out.chunks || [];
    log("Transcript: " + (out.text || "").trim());

    const hits = chunks.filter((c) => c.timestamp && targets.has(norm(c.text)));
    if (hits.length === 0) {
      log("No target words found — nothing to bleep.");
      setStatus("No matches found.");
      return;
    }
    log(`Bleeping ${hits.length} word(s):`);
    const pad = 0.06;
    const intervals = mergeIntervals(hits.map((c) => {
      const [s, e] = c.timestamp;
      log(`  ${s.toFixed(2)}–${(e ?? s).toFixed(2)}  "${c.text.trim()}"`);
      return [Math.max(0, s - pad), Math.min(dur, (e ?? s + 0.3) + pad)];
    }));

    setStatus("Rendering…", true);
    const gate = intervals.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
    const fc =
      `[0:a]aformat=channel_layouts=stereo,volume='1-(${gate})':eval=frame[v];` +
      `sine=f=1000:r=48000:d=${(dur + 1).toFixed(2)},pan=stereo|c0=c0|c1=c0,` +
      `volume='0.35*(${gate})':eval=frame[t];` +
      `[v][t]amix=inputs=2:duration=first:normalize=0[a]`;
    log("Rendering bleeped video…");
    await fmp.exec(["-i", inName, "-filter_complex", fc,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy",
      "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "out.mp4"]);

    const data = await fmp.readFile("out.mp4");
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    player.src = url;
    dl.href = url;
    dl.download = file.name.replace(/\.[^.]+$/, "") + "_bleeped.mp4";
    result.hidden = false;
    log("Done.");
    setStatus(`Done — bleeped ${hits.length} word(s).`);
  } catch (err) {
    console.error(err);
    log("ERROR: " + (err?.message || err));
    setStatus("Error — see log.");
  } finally {
    goBtn.disabled = !file;
    goBtn.textContent = "Bleep it";
  }
}

setStatus("Pick a video to begin.");
