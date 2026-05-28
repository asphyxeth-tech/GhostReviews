# Security Policy

This is a **public** repository. Secret hygiene is treated as a first-class concern.

## Reporting a vulnerability

If you discover a security issue, please open a private GitHub Security Advisory at:
https://github.com/asphyxeth-tech/DeveloperWeek2026Hackathon/security/advisories/new

We aim to acknowledge within 48 hours.

## Secret-handling policy

### Where secrets live

| Layer            | Location                                 | Notes                                |
| ---------------- | ---------------------------------------- | ------------------------------------ |
| Local dev        | `.env.local` (gitignored)                | Never committed. Copy `.env.example` |
| Production (web) | Vercel → Project Settings → Env Vars     | Encrypted at rest                    |
| Pipeline         | Tower secrets manager                    | Encrypted at rest                    |

`.env*` files are blocked by `.gitignore` (with one exception: `.env.example`, which contains only empty placeholder keys).

### Layered defenses against accidental commits

1. **`.gitignore`** — Git refuses to track `.env*` files at all.
2. **GitHub Secret Scanning** (free, automatic for public repos) — every push is scanned against thousands of known key patterns; many providers (including Anthropic) participate in [partner secret scanning](https://docs.github.com/en/code-security/secret-scanning) and may auto-revoke leaked keys.
3. **GitHub Push Protection** (free for public repos) — refuses pushes containing recognized secrets before they reach GitHub at all. *Verify this is enabled at Settings → Code security → "Push protection".*
4. **Local pre-commit hook** (optional) — scans the staged diff for common secret patterns before letting a commit proceed.

### Enable the local pre-commit hook (recommended)

One-time setup per clone:

```bash
git config core.hooksPath .githooks
```

The hook lives at `.githooks/pre-commit`. It runs in ~100ms and matches against patterns for Anthropic, OpenAI, AWS, GitHub, Slack, Google, and generic PEM private-key headers. If you ever need to bypass it (for a real false-positive only), use `git commit --no-verify`.

## What to do if a secret is accidentally committed

The moment any secret touches a public commit, assume it is compromised. Scrapers watch public commit feeds in real time and can scoop a key within seconds.

1. **Rotate the key at the provider immediately.** Don't try to "scrub" git history first — the key is already out. Use the provider's "regenerate" button.
2. **Update the new key in `.env.local`, Vercel, and Tower** as applicable.
3. **Document the incident** with a short note: what leaked, when it landed, when it was rotated.
4. **Force-push the cleaned history only as a secondary measure**, after the key is rotated. Rewriting public history is unreliable security; rotation is the real fix.

## Current `npm audit` posture

`npm audit` currently reports 2 moderate-severity advisories. Both originate from a transitive `postcss` dependency that Next.js 16 bundles internally:

- [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — `postcss < 8.5.10`, XSS via unescaped `</style>` in CSS stringify output.

This advisory does not affect a Next.js app that uses server-side Tailwind compilation (our setup) — the vulnerable code path is the runtime CSS stringifier, which we do not execute on untrusted CSS input. The "fix" `npm audit` suggests is a major-version downgrade of Next.js to v9, which is not a real remediation.

We will bump Next.js when a patched release is published. No user-impacting risk for the MVP.
