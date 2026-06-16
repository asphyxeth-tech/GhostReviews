// The Ghost Reviews logo lockup — single source of truth for the mark.
//
// A glowing spectral orb followed by the /ghostreviews/ wordmark, with the
// slashes in the accent lavender so it reads as a regex literal (on-theme for
// a fraud-pattern-detection product). Callers supply the flex container
// (a <div> or a <Link>); this renders the orb + wordmark inside it.
//
//   size="base" — header/auth pages (larger orb, with the glow-pulse animation)
//   size="sm"   — footer (smaller, static orb)
export function Wordmark({ size = "base" }: { size?: "base" | "sm" }) {
  const orbClass =
    size === "sm"
      ? "inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]"
      : "glow-pulse inline-block h-2 w-2 rounded-full bg-[color:var(--accent)]";
  return (
    <>
      <span aria-hidden className={orbClass} />
      <span>
        <span className="text-[color:var(--accent)]">/</span>ghostreviews<span className="text-[color:var(--accent)]">/</span>
      </span>
    </>
  );
}
