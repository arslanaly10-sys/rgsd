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
   - `AUTH_SECRET` (random, e.g. `openssl rand -base64 32`), `AUTH_MODE=demo` for the demo, `otp` for real use (see Sign-in), `APP_URL` (the public URL)
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

Evals: `npm run evals` runs `evals/cases.json` (routing, tool choice, approval tiers, tenant isolation, prompt injection, Arabic) against the running app and writes `test-results/evals.md`. CI fails if any safety case fails or the score drops below 90%. Run it with `AI_MODE=live` to measure Claude on the same cases.

## Sign-in and access

- `AUTH_MODE=demo`: persona picker plus email-code sign-in; codes are shown on screen. Sample data only.
- `AUTH_MODE=otp`: production. No picker, no passwords. People sign in with a 6-digit code emailed to them (10 minutes, 5 attempts, 3 codes per 10 minutes, the same answer for unknown addresses). Roles in `MFA_REQUIRED_ROLES` (default `admin,finance`) must add an authenticator app (Google/Microsoft Authenticator) before anything else.
- Access is by invitation: admins invite anyone (**Stage 1 review → People & access**), client admins invite colleagues from their own company (**Help → People & access**). Disabling someone, or **Account → Sign out everywhere**, ends their sessions at once.
- Set `RESEND_API_KEY` before switching to `otp`, or codes can't reach anyone. Sign-in codes and invitation links are never stored readable.

## Notifications

The bell always shows everything. People choose email, WhatsApp and SMS (urgent only) in **Account & security**. Messages go through an outbox (**Stage 1 review → Message outbox**); each provider switches on when its key is set, otherwise messages are logged there:

| Channel | Provider | Variables |
|---|---|---|
| Email | Resend | `RESEND_API_KEY`, `EMAIL_FROM` |
| WhatsApp | Meta WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` |
| SMS | Unifonic (KSA) | `UNIFONIC_APP_SID`, `UNIFONIC_SENDER` |

The 5-minute workflow tick also dispatches pending notifications.

## Stage 1 review (admins)

`/ops/admin`: design system, live data model, permission matrix (pages, sign-offs, agent tool tiers), **access tester** (runs read queries as any person under row-level security and checks every table against its rule), interface states, architecture, people & invitations, message outbox, and a go-live readiness checklist.

## Tests and CI

```bash
npm run selftest      # TOTP vectors, no database
npm run test:e2e      # 9 Playwright suites against a running app (DB_LOCAL=1, resets the DB)
npm run evals         # agent evals
```

`.github/workflows/ci.yml` runs typecheck, selftest, migrations + seed on Postgres 16 with pgvector, build, all e2e suites and the evals on every push and pull request.
