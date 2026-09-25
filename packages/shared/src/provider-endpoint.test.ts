import { describe, expect, it } from "vitest";
import { isAllowedBaseURL, withBaseURLOverride } from "./provider-endpoint";

describe("provider base URL override", () => {
  it("accepts only loopback http(s) URLs", () => {
    expect(isAllowedBaseURL("http://127.0.0.1:8600/deepseek")).toBe(true);
    expect(isAllowedBaseURL("http://localhost:8600/anthropic/v1")).toBe(true);
    expect(isAllowedBaseURL("http://[::1]:8600/openai")).toBe(true);
    expect(isAllowedBaseURL("https://evil.example.com/v1")).toBe(false);
    expect(isAllowedBaseURL("http://127.0.0.1.evil.com/v1")).toBe(false);
    expect(isAllowedBaseURL("file:///etc/passwd")).toBe(false);
    expect(isAllowedBaseURL("not a url")).toBe(false);
  });

  it("applies a valid override and ignores empty or rejected ones", () => {
    const p = { id: "deepseek", baseURL: "https://api.deepseek.com/v1" };
    expect(withBaseURLOverride(p, "http://127.0.0.1:8600/deepseek/").baseURL).toBe("http://127.0.0.1:8600/deepseek");
    expect(withBaseURLOverride(p, "")).toBe(p);
    expect(withBaseURLOverride(p, undefined)).toBe(p);
    expect(withBaseURLOverride(p, "https://evil.example.com")).toBe(p);
  });
});
