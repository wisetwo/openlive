import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { DATA_DIR } from "@openlive/db";
import { log } from "../log.js";

// Qwen3-ASR 0.6B INT8 via sherpa-onnx (same Node addon ZipVoice uses). Optional
// user-managed download; audio stays on this machine. Lazy-loaded so the agent
// boots without the native module if coach mode is never used.

export const ASR_MODEL_DIR = resolve(DATA_DIR, "models", "qwen3-asr");
// Same 0.6B INT8 export sherpa-onnx documents. ModelScope is the China-reachable
// source; files land flattened next to tokenizer/ (the GitHub tarball layout).
export const ASR_MODELSCOPE_ROOT =
  "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/master";
export const ASR_FILES = [
  { remote: "model_0.6B/conv_frontend.onnx", local: "conv_frontend.onnx", bytes: 44_148_281 },
  { remote: "model_0.6B/encoder.int8.onnx", local: "encoder.int8.onnx", bytes: 182_491_662 },
  { remote: "model_0.6B/decoder.int8.onnx", local: "decoder.int8.onnx", bytes: 755_914_231 },
  { remote: "tokenizer/vocab.json", local: "tokenizer/vocab.json", bytes: 2_776_833 },
  { remote: "tokenizer/merges.txt", local: "tokenizer/merges.txt", bytes: 1_671_853 },
  { remote: "tokenizer/tokenizer_config.json", local: "tokenizer/tokenizer_config.json", bytes: 12_487 },
] as const;
export const ASR_DOWNLOAD_BYTES = ASR_FILES.reduce((n, f) => n + f.bytes, 0);

const MODEL_FILES = ["conv_frontend.onnx", "encoder.int8.onnx", "decoder.int8.onnx"];
const IDLE_UNLOAD_MS = 5 * 60_000;

function fileAtLeast(path: string, bytes: number): boolean {
  try { return statSync(path).size >= bytes; } catch { return false; }
}

export function asrModelInstalled(): boolean {
  return MODEL_FILES.every((f) => fileAtLeast(join(ASR_MODEL_DIR, f), 1024))
    && existsSync(join(ASR_MODEL_DIR, "tokenizer"));
}

export function asrModelDiskBytes(): number {
  let total = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += statSync(p).size; } catch { /* racing a delete */ } }
    }
  };
  try { walk(ASR_MODEL_DIR); } catch { /* not installed */ }
  return total;
}

type SherpaAsr = {
  OfflineRecognizer: new (cfg: unknown) => {
    createStream(): {
      acceptWaveform(req: { sampleRate: number; samples: Float32Array }): void;
    };
    decode(stream: unknown): void;
    getResult(stream: unknown): { text?: string };
  };
};

let sherpa: SherpaAsr | null = null;
let recognizer: InstanceType<SherpaAsr["OfflineRecognizer"]> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function loadRecognizer(): InstanceType<SherpaAsr["OfflineRecognizer"]> {
  if (recognizer) return recognizer;
  if (!asrModelInstalled()) throw new Error("qwen3-asr model not installed");
  sherpa ??= createRequire(import.meta.url)("sherpa-onnx-node") as SherpaAsr;
  if (!sherpa.OfflineRecognizer) throw new Error("this sherpa-onnx-node build has no OfflineRecognizer (need a version with Qwen3-ASR)");
  const t = Date.now();
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 128 },
    modelConfig: {
      qwen3Asr: {
        convFrontend: join(ASR_MODEL_DIR, "conv_frontend.onnx"),
        encoder: join(ASR_MODEL_DIR, "encoder.int8.onnx"),
        decoder: join(ASR_MODEL_DIR, "decoder.int8.onnx"),
        tokenizer: join(ASR_MODEL_DIR, "tokenizer"),
        maxNewTokens: 128,
      },
      tokens: "",
      numThreads: 4,
      provider: "cpu",
    },
  });
  log.debug("asr", `qwen3-asr engine loaded in ${Date.now() - t}ms`);
  return recognizer;
}

export function unloadAsrEngine(): void {
  recognizer = null;
  clearTimeout(idleTimer);
}

const armIdleUnload = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(unloadAsrEngine, IDLE_UNLOAD_MS);
  idleTimer.unref?.();
};

function resampleTo16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 16000) return samples;
  const ratio = sampleRate / 16000;
  const out = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)));
  for (let i = 0; i < out.length; i++) out[i] = samples[Math.min(samples.length - 1, Math.floor(i * ratio))]!;
  return out;
}

/** Strip non-speech annotations Whisper/Qwen sometimes emit on noise. */
export function cleanTranscript(s: string): string {
  let out = "";
  let paren = 0;
  let brack = 0;
  let star = false;
  for (const c of s) {
    if (c === "(" || c === "（" || c === "〔") paren += 1;
    else if (c === ")" || c === "）" || c === "〕") paren = Math.max(0, paren - 1);
    else if (c === "[" || c === "【" || c === "［") brack += 1;
    else if (c === "]" || c === "】" || c === "］") brack = Math.max(0, brack - 1);
    else if (c === "*") star = !star;
    else if (paren === 0 && brack === 0 && !star) out += c;
  }
  const cleaned = out.split(/\s+/).filter(Boolean).join(" ");
  const meaningful = [...cleaned].filter((c) => /\p{Letter}|\p{Number}/u.test(c)).length;
  return meaningful <= 1 ? "" : cleaned;
}

export function transcribePcm(samples: Float32Array, sampleRate: number): Promise<string> {
  const run = queue.then(() => {
    const rec = loadRecognizer();
    const audio = resampleTo16k(samples, sampleRate);
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples: audio });
    rec.decode(stream);
    const text = cleanTranscript(String(rec.getResult(stream)?.text ?? "").trim());
    armIdleUnload();
    return text;
  });
  queue = run.catch(() => {});
  return run;
}
