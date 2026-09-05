import { test } from "vitest";
import assert from "node:assert";
import { cleanTranscript } from "./asr.ts";

test("cleanTranscript drops parenthetical noise and keeps real speech", () => {
  assert.equal(cleanTranscript("(buzzing)"), "");
  assert.equal(cleanTranscript("[BLANK_AUDIO]"), "");
  assert.equal(cleanTranscript("hello world"), "hello world");
  assert.equal(cleanTranscript("你好"), "你好");
});
