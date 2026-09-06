// Opt-in (dev-default) Trace Lens-compatible prompt tracing for live LLM calls.
//
// Each agent process appends one JSONL file under
// `<data>/logs/prompt-traces/`. One file per process keeps `seq` unique and
// monotonically increasing across restarts. Failures never block a model reply.
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "@openlive/db";
import { streamProvider, type ChatRequest, type Message, type ProviderEvent, type ProviderInfo } from "@openlive/harness";

export interface PromptTraceContext {
  source: string;
  sessionId?: string;
}

export interface PromptTraceOpts {
  source?: string;
  /** Skip writing (cache-warm / tiny throwaway calls). */
  skip?: boolean;
}

const store = new AsyncLocalStorage<PromptTraceContext>();
let seq = 1;
let filePath: string | undefined;

export function promptTraceEnabled(): boolean {
  const flag = process.env.OPENLIVE_PROMPT_TRACE?.trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  // Packaged desktop does not set NODE_ENV=development on the agent. Local
  // `pnpm dev` / `desktop:dev` does (agent script + npm_lifecycle_event).
  return process.env.NODE_ENV === "development" || process.env.npm_lifecycle_event === "dev";
}

export function promptTraceDir(): string {
  return join(DATA_DIR, "logs", "prompt-traces");
}

export function withPromptTrace<T>(ctx: PromptTraceContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function promptTraceContext(): PromptTraceContext | undefined {
  return store.getStore();
}

function traceFilePath(): string {
  if (filePath) return filePath;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(promptTraceDir(), { recursive: true });
  filePath = join(promptTraceDir(), `prompt-trace-${stamp}-${process.pid}.jsonl`);
  return filePath;
}

function nextSeq(): number {
  return seq++;
}

/** Flatten harness messages into Trace Lens-friendly {role, content} objects.
 *  Image bytes are dropped (count only) so traces stay small and reviewable. */
export function serializeMessages(messages: Message[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "system") return { role: "system", content: m.text };
    if (m.role === "user") {
      const entry: Record<string, unknown> = { role: "user", content: m.text };
      if (m.images?.length) entry.imageCount = m.images.length;
      return entry;
    }
    if (m.role === "assistant") {
      const entry: Record<string, unknown> = { role: "assistant", content: m.text ?? "" };
      if (m.reasoning) entry.reasoning = m.reasoning;
      if (m.toolCalls?.length) entry.toolCalls = m.toolCalls;
      return entry;
    }
    return { role: "tool", content: m.result, name: m.name, callId: m.callId, isError: m.isError ?? false };
  });
}

export function buildTraceEntry(opts: {
  seq: number;
  request: ChatRequest;
  context?: PromptTraceContext;
  provider: string;
  modelId?: string;
  response?: string;
  error?: string;
}): Record<string, unknown> {
  const { seq: n, request, context, provider, modelId, response, error } = opts;
  const source = context?.source?.trim() || "generation";
  const sessionId = context?.sessionId?.trim() || undefined;
  const sessionKey = sessionId ? `${source}:${sessionId}` : source;
  const system = request.messages.find((m) => m.role === "system")?.text;
  const prompt = [...request.messages].reverse().find((m) => m.role === "user")?.text;
  const messages = serializeMessages(request.messages);
  if (response) messages.push({ role: "assistant", content: response });
  const completed = response != null || error != null;
  const stage = error ? "prompt:error" : completed ? "stream:context" : "prompt:before";
  const eventType = error ? "llm.error" : completed ? "llm.ended" : "llm.started";
  return {
    ts: new Date().toISOString(),
    seq: n,
    stage,
    traceVersion: 1,
    eventType,
    runId: `openlive-${process.pid}-${n}`,
    sessionId: sessionId ?? null,
    sessionKey,
    agentId: source,
    agentLabel: source,
    agentRole: source === "worker" ? "worker" : "lead",
    provider,
    modelId: modelId ?? request.model,
    source,
    system,
    prompt,
    messages,
    messageCount: messages.length,
    // Top-level `tools` is what Trace Lens renders (name / description / JSON Schema).
    tools: request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    toolCount: request.tools.length,
    params: {
      model: request.model,
      effort: request.effort,
      reasoningEffort: request.reasoningEffort,
      maxTokens: request.maxTokens,
      thinking: request.thinking,
    },
    response: response ?? null,
    error: error ?? null,
  };
}

export function appendTraceTo(path: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

function write(entry: Record<string, unknown>): void {
  try {
    appendTraceTo(traceFilePath(), entry);
  } catch {
    /* tracing must never take down a turn */
  }
}

/** Drop-in for `streamProvider`: same events, plus JSONL start/end records. */
export async function* tracedStreamProvider(
  provider: ProviderInfo,
  apiKey: string | undefined,
  req: ChatRequest,
  signal: AbortSignal,
  extra?: PromptTraceOpts,
): AsyncGenerator<ProviderEvent> {
  const parent = store.getStore();
  if (!promptTraceEnabled() || extra?.skip) {
    yield* streamProvider(provider, apiKey, req, signal);
    return;
  }
  const context: PromptTraceContext = {
    source: extra?.source || parent?.source || "generation",
    sessionId: parent?.sessionId,
  };
  const startedSeq = nextSeq();
  write(buildTraceEntry({
    seq: startedSeq,
    request: req,
    context,
    provider: provider.id,
    modelId: req.model,
  }));
  let response = "";
  try {
    for await (const ev of streamProvider(provider, apiKey, req, signal)) {
      if (ev.type === "text") response += ev.delta;
      yield ev;
    }
    write(buildTraceEntry({
      seq: nextSeq(),
      request: req,
      context,
      provider: provider.id,
      modelId: req.model,
      response,
    }));
  } catch (e) {
    write(buildTraceEntry({
      seq: nextSeq(),
      request: req,
      context,
      provider: provider.id,
      modelId: req.model,
      response: response || undefined,
      error: String((e as Error)?.message ?? e),
    }));
    throw e;
  }
}
