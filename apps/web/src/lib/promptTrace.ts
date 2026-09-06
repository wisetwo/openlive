/** Dev-only Trace Lens helper. Production builds tree-shake the UI that imports this. */
export const DEV_PROMPT_TRACE = process.env.NODE_ENV !== "production";

/** Shell command that opens Trace Lens filtered to one OpenLive conversation. */
export function promptTraceCommand(sessionId: string): string {
  return `pnpm trace:prompts -- --session ${JSON.stringify(sessionId)}`;
}
