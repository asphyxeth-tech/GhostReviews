"use client";

import { useState } from "react";

// Tiny client island: copies a prepared string to the clipboard with brief
// "Copied ✓" feedback. The text is assembled server-side and passed in, so this
// component stays dumb and reusable.
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied ✓",
  className,
  title,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <button
      onClick={copy}
      title={title}
      className={
        className ??
        "rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-4 py-2 text-sm font-semibold text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20"
      }
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
