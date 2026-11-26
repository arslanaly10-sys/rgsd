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

## Deploy (Supabase + Vercel)

Supabase project **rgs-onesite** (`fufccfjjvlnbbqtyytqn`, region ap-south-1) already has every migration in `supabase/migrations` applied. It holds no data yet.

1. In Supabase: **Connect → Session pooler**. Copy the connection string and put in the database password.
2. In Vercel, import this repo and set the environment variables:
   - `DATABASE_URL` the pooler string, `DB_LOCAL=0`
   - `AUTH_SECRET` (random, e.g. `openssl rand -base64 32`), `AUTH_MODE=demo`
   - `AI_MODE=mock` (or `live` with `ANTHROPIC_API_KEY`)
   - `CRON_SECRET` (random) for the workflow and watcher crons
   - `STORAGE_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET=documents` (create a **private** bucket named `documents`)
   - once only: `ALLOW_SEED=1` and `SEED_SECRET` (random)
3. After the first deploy, load the sample data once, then remove `ALLOW_SEED`:

   ```bash
   curl -X POST https://<your-app>.vercel.app/api/admin/seed -H "Authorization: Bearer $SEED_SECRET"
   ```

The seed endpoint refuses to run on a database that already has data. Vercel's free plan runs crons once a day at most; the 5-minute workflow tick needs a paid plan, or Supabase `pg_cron` calling `/api/workflows/tick`.

## AI

`AI_MODE=mock` (default) runs agents with deterministic outputs and no API key. Set `AI_MODE=live` and `ANTHROPIC_API_KEY`, or `AI_PROVIDER=gateway` with `AI_GATEWAY_API_KEY`, to use Claude.
