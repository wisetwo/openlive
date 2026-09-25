// Optional per-provider base URL override (e.g. a local debugging proxy that
// forwards to the real API). Stored as a plain setting keyed by provider id.

export const BASE_URL_SETTING_PREFIX = "baseURL:";

export function baseURLSettingKey(providerId: string): string {
  return `${BASE_URL_SETTING_PREFIX}${providerId}`;
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** The override carries the provider's API key, so only loopback http(s) hosts
 *  are accepted — a stray or injected value can't ship the key off-machine. */
export function isAllowedBaseURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK.test(url.hostname);
  } catch {
    return false;
  }
}

/** A provider with its override applied, or unchanged when none/invalid. */
export function withBaseURLOverride<T extends { baseURL: string }>(provider: T, override: string | undefined | null): T {
  const url = override?.trim();
  return url && isAllowedBaseURL(url) ? { ...provider, baseURL: url.replace(/\/+$/, "") } : provider;
}
