// Guards the fetch_url SSRF classifier and HTML entity decoding — both are
// security/correctness paths where a silent miss is exploitable or corrupting.
import assert from "node:assert";
import { test } from "vitest";
import { isPrivateIp, htmlToText, toolsForLiveMode, type OpenLiveTool } from "./tools.ts";

test("isPrivateIp: blocks loopback/private incl. IPv4-mapped IPv6", () => {
  // Private / loopback / metadata — must all be blocked.
  for (const ip of [
    "127.0.0.1", "10.0.0.1", "192.168.1.5", "172.16.0.1", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "fc00::1",
    "::ffff:127.0.0.1",   // IPv4-mapped, dotted — the reported bypass
    "::ffff:7f00:1",      // IPv4-mapped, hex form of 127.0.0.1
    "[::ffff:169.254.169.254]", // bracketed cloud-metadata address
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  // Public addresses — must be allowed.
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "203.0.113.5"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test("htmlToText: astral codepoints survive, entities decode once", () => {
  assert.equal(htmlToText("<p>hi &#128512;</p>"), "hi 😀");     // emoji, not broken surrogates
  assert.equal(htmlToText("a &amp;lt; b"), "a &lt; b");          // &amp; decoded last (no double-decode)
  assert.equal(htmlToText("<b>x</b> &amp; <i>y</i>"), "x & y");
});

test("toolsForLiveMode: coach gets look/delegate/remember, not files or clipboard", () => {
  const stub = (name: string): OpenLiveTool => ({
    name, description: name, parameters: { type: "object", properties: {} }, execute: async () => ({ output: "" }),
  });
  const extra = ["look", "clipboard_read", "clipboard_write", "open_url", "list_dir", "read_file", "write_file", "edit_file"].map(stub);
  const ctx = { emit: async () => {} };
  assert.deepEqual(toolsForLiveMode("english-coach", extra, ctx).map((t) => t.name).sort(), ["delegate", "look", "remember"]);
  const live = toolsForLiveMode("live", extra, ctx).map((t) => t.name);
  assert.ok(live.includes("update_todos"));
  assert.ok(live.includes("open_url"));
  assert.ok(live.includes("write_file"));
});

