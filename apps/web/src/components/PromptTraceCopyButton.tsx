"use client";

import { useState } from "react";
import { Check, Terminal } from "lucide-react";
import { DEV_PROMPT_TRACE, promptTraceCommand } from "@/lib/promptTrace";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

/** Dev-only: copy `pnpm trace:prompts -- --session <id>` for Trace Lens. */
export function PromptTraceCopyButton({
  sessionId,
  className,
  iconClass = "size-3",
}: {
  sessionId: string;
  className?: string;
  iconClass?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!DEV_PROMPT_TRACE || !sessionId) return null;

  const copy = () => {
    const cmd = promptTraceCommand(sessionId);
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => toast(cmd, "info"));
  };

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); copy(); }}
      title={copied ? "Command copied" : "Copy command to view this chat's prompt traces"}
      aria-label="Copy prompt-trace command"
      className={cn(className)}
    >
      {copied ? <Check className={iconClass} strokeWidth={2.2} /> : <Terminal className={iconClass} />}
    </button>
  );
}
