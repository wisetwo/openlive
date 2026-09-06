import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendTraceTo, buildTraceEntry, serializeMessages } from "./prompt-trace.js";
import type { ChatRequest, Message } from "@openlive/harness";

describe("prompt-trace JSONL shape", () => {
  it("strips image bytes and keeps tool calls", () => {
    const messages: Message[] = [
      { role: "system", text: "Be concise" },
      { role: "user", text: "Hello", images: [{ data: "AAA", mime: "image/jpeg" }] },
      { role: "assistant", text: "Hi", toolCalls: [{ id: "1", name: "look", arguments: "{}" }] },
      { role: "tool", callId: "1", name: "look", result: "a bottle" },
    ];
    const out = serializeMessages(messages);
    expect(out[1]).toMatchObject({ role: "user", content: "Hello", imageCount: 1 });
    expect(JSON.stringify(out)).not.toContain("AAA");
    expect(out[2]).toMatchObject({ role: "assistant", toolCalls: [{ name: "look" }] });
  });

  it("writes Trace Lens-compatible start + completion lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "ol-prompt-trace-"));
    const path = join(dir, "trace.jsonl");
    const request: ChatRequest = {
      model: "test-model",
      messages: [
        { role: "system", text: "Be concise" },
        { role: "user", text: "Hello" },
      ],
      tools: [{
        name: "look",
        description: "Grab a fresh camera frame",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }],
      maxTokens: 64,
    };
    const context = { source: "live", sessionId: "conversation-1" };
    appendTraceTo(path, buildTraceEntry({
      seq: 7,
      request,
      context,
      provider: "anthropic",
      modelId: "test-model",
    }));
    appendTraceTo(path, buildTraceEntry({
      seq: 8,
      request,
      context,
      provider: "anthropic",
      modelId: "test-model",
      response: "Hi there!",
    }));
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({
      seq: 7,
      stage: "prompt:before",
      eventType: "llm.started",
      sessionKey: "live:conversation-1",
      system: "Be concise",
      prompt: "Hello",
      messageCount: 2,
      toolCount: 1,
      tools: [{
        name: "look",
        description: "Grab a fresh camera frame",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }],
    });
    expect(lines[1]).toMatchObject({
      seq: 8,
      stage: "stream:context",
      eventType: "llm.ended",
      response: "Hi there!",
      messageCount: 3,
    });
    expect((lines[1]!.messages as { role: string; content: string }[])[2]).toEqual({
      role: "assistant",
      content: "Hi there!",
    });
    rmSync(dir, { recursive: true, force: true });
  });
});
