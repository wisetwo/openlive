import { test } from "vitest";
import assert from "node:assert";
import { CoachSpeechPump } from "./coachSpeech.ts";

test("CoachSpeechPump speaks Try: then the reply, never tags or feedback", () => {
  const p = new CoachSpeechPump();
  p.reset("I go store");
  const lines: string[] = [];
  lines.push(...p.push("<NATURAL>I went to the store.</NATURAL>"));
  lines.push(...p.push("<FEEDBACK>Use the past tense.</FEEDBACK>"));
  lines.push(...p.push("<REPLY>Nice. What did you buy?</REPLY>"));
  lines.push(...p.flush());
  const spoken = lines.join(" ");
  assert.match(spoken, /^Try: I went to the store\./);
  assert.match(spoken, /What did you buy/);
  assert.doesNotMatch(spoken, /NATURAL|FEEDBACK|REPLY|past tense/);
});
