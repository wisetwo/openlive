import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

let sessionId = null;
const traceLensArgs = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--session") {
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      console.error("--session requires a conversation id.");
      process.exit(1);
    }
    sessionId = value;
    i += 1;
  } else if (arg.startsWith("--session=")) {
    sessionId = arg.slice("--session=".length) || null;
  } else {
    traceLensArgs.push(arg);
  }
}

if (args.some((arg) => arg.startsWith("--session=")) && !sessionId) {
  console.error("--session requires a conversation id.");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.OPENLIVE_DATA_DIR
  ? resolve(process.env.OPENLIVE_DATA_DIR)
  : join(repoRoot, "data");
const traceDir = join(dataDir, "logs", "prompt-traces");

if (!existsSync(traceDir)) {
  console.error(
    `No prompt traces yet: ${traceDir}\nRun \`pnpm dev\`, have a live conversation, then retry.`,
  );
  process.exit(1);
}

function buildSessionView(dir, targetSessionId) {
  const matching = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(dir, name);
    const lines = readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const key = typeof entry.sessionKey === "string" ? entry.sessionKey : "";
        if (
          entry.sessionId === targetSessionId ||
          key === targetSessionId ||
          key.endsWith(`:${targetSessionId}`)
        ) {
          matching.push({
            entry,
            sourceFile: name,
            sourceSeq: typeof entry.seq === "number" ? entry.seq : 0,
          });
        }
      } catch {
        // A partial/corrupt line should not hide valid entries from other runs.
      }
    }
  }

  if (matching.length === 0) {
    console.error(
      `No prompt traces found for conversation ${targetSessionId}.\n` +
        "Dev tracing is on during `pnpm dev`; send a message in that chat first.",
    );
    process.exit(1);
  }

  matching.sort(
    (a, b) =>
      String(a.entry.ts || "").localeCompare(String(b.entry.ts || "")) ||
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.sourceSeq - b.sourceSeq,
  );
  const normalized = matching.map(({ entry, sourceFile, sourceSeq }, index) => ({
    ...entry,
    seq: index + 1,
    sourceFile,
    sourceSeq,
  }));
  const viewsDir = join(dir, ".views");
  mkdirSync(viewsDir, { recursive: true });
  const safeId =
    targetSessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "session";
  const viewFile = join(viewsDir, `${safeId}.jsonl`);
  writeFileSync(
    viewFile,
    normalized.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
  console.log(
    `Conversation ${targetSessionId}: ${normalized.length} trace events`,
  );
  return viewFile;
}

const inputPath = sessionId ? buildSessionView(traceDir, sessionId) : traceDir;
const command = process.platform === "win32" ? "trace-lens.cmd" : "trace-lens";
const child = spawn(command, [inputPath, ...traceLensArgs], { stdio: "inherit" });
child.on("error", (error) => {
  console.error(
    `Could not start trace-lens (${error.message}). Install @wisetwo/trace-lens globally first.`,
  );
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
