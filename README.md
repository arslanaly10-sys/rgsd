# RGS OneSite

Agentic AI platform for Resa Gulf Scaffolding (RGS): requests and quotes, inspections and tag compliance, rental fleet and logistics, workforce and certifications. Bilingual (English / Arabic RTL).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

> All data in this repo is **sample data**. Sites are named after public RGS projects; people, numbers, tags and rates are fictional.

## Run locally

Requires Node 22+ and PostgreSQL 16 with the `pgvector` extension.

```bash
cp .env.example .env          # set AUTH_SECRET
createuser -s rgs && createdb -O rgs rgs_onesite   # or use any Postgres URL in DATABASE_URL
npm install
npm run db:reset              # applies migrations + loads sample data (local only)
npm run dev                   # http://localhost:3000
```

Sign in by picking a person on the login screen (demo mode). Try:

- **Imran Qureshi** (Operations Manager): full console
- **Arjun Nair** (Inspector): open `/field` on a phone-width window
- **Elena Petrova** (Sadara client): sees only Sadara's sites, scaffolds, issued quotes and invoices

## Supabase

Point `DATABASE_URL` at the project's session pooler connection string, set `DB_LOCAL=0`, then run `npm run db:migrate` and `npm run db:seed`.

## AI

`AI_MODE=mock` (default) runs agents with deterministic outputs and no API key. Set `AI_MODE=live` and `ANTHROPIC_API_KEY`, or `AI_PROVIDER=gateway` with `AI_GATEWAY_API_KEY`, to use Claude.
