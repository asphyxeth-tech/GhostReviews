# ghost.reviews

**Catch the ghosts haunting your Google reviews.**

ghost.reviews is a B2B web app that helps local business owners detect coordinated, fraudulent review attacks ("review bombing") on their **Google Business Profile**, produces a transparent evidence report, and drafts an official **policy-violation removal request** they can submit to Google.

Built for the [DeveloperWeek New York 2026 Hackathon](https://dwny-2026-hackathon.devpost.com/). Submission deadline: **June 10, 2026, 10:00 AM ET**.

> **Live demo:** https://ghost-reviews-ten.vercel.app/

---

## Why this exists

Fake and planted reviews are now federally illegal in the U.S. under the FTC's Consumer Review Rule (2024), with penalties up to ~$53,000 per violation. A coordinated 1-star "bomb" can tank a small business's revenue overnight. Owners need a fast, transparent way to identify suspicious clusters of reviews and pursue the official removal process — without resorting to anything shady.

## What it does

1. **You paste your Google Business Profile URL** (or business name + location).
2. **We pull recent public reviews** via the Nimble API.
3. **Claude analyzes the reviews** for coordinated-attack signals — timing clusters, low-history reviewer accounts, near-identical phrasing, rating anomalies, vague complaints with no specifics.
4. **You get an authenticity report** — an overall risk score plus a list of flagged reviews, each one with a plain-English explanation of *why* it was flagged.
5. **For each flagged review, you get a drafted removal request** — text you can copy and submit through Google's official policy-violation channel.

Outputs are always framed as **likelihood + transparent reasoning**, never a definitive "this is fake" verdict. We don't delete reviews. We don't automate mass-flagging. We don't help bury honest negative criticism — suppressing legitimate reviews is itself an FTC violation and is firmly out of scope.

## Built with

- **[Nimble](https://nimbleway.com/)** — live Google review scraping via Search / Extract / Crawl / Web APIs
- **[Tower](https://tower.dev/)** — Pythonic serverless compute for the scrape → analyze pipeline
- **[name.com](https://name.com/)** — the domain is the conceptual heart of the project
- **[Claude API](https://www.anthropic.com/)** (Anthropic) — fraud-signal analysis and removal-request drafting
- **[Next.js](https://nextjs.org/)** (App Router) + **[Tailwind CSS](https://tailwindcss.com/)** — frontend
- **[Vercel](https://vercel.com/)** — hosting

## Repo layout

```
.
├── src/                    Next.js app (the live web interface)
│   ├── app/                  App Router pages + /api/analyze route
│   ├── components/           UrlAnalyzeForm + AnalysisReport (results UI)
│   └── lib/                  Anthropic client, Zod schemas, mock data
└── pipeline/               Tower app (the batch-mode analysis pipeline)
    ├── task.py               Python entrypoint
    ├── Towerfile             Tower app manifest
    └── README.md             Full setup + deploy guide for the pipeline
```

The web app (Next.js on Vercel) gives end users an instant report. The Tower pipeline runs the same Claude Opus 4.7 analysis as an orchestration-mode job — same prompt, same schema, same outputs. See [`pipeline/README.md`](./pipeline/README.md) for the Tower integration.

## Local setup

> Setup steps will be filled in as the app is scaffolded. See `CLAUDE.md` for the working build plan.

You will need API keys for:
- Anthropic (Claude API)
- Nimble
- Tower

Copy `.env.example` to `.env.local` and fill in your keys. **Never commit `.env*` files** — they're gitignored.

## Ethical use

ghost.reviews is a tool for owners who have been targeted by **policy-violating** review activity. It is not a tool for hiding honest negative feedback. All output is probabilistic and intended as evidence the owner submits through Google's official channels — we do not, and will not, attempt to delete reviews or game Google's systems.

## License

[MIT](./LICENSE)
