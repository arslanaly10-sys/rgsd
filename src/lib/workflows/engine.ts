import "server-only";
import { one, rows, withSystem } from "@/lib/db";

/*
 * Durable workflows on Postgres. Each step's output is saved; a re-run skips completed steps,
 * so a crash or timeout resumes where it stopped. Failed runs retry with backoff (3 attempts).
 * Swap for Vercel Workflow / Inngest / Temporal later behind the same start/run interface.
 */
export type StepCtx<I> = { runId: string; orgId: string; input: I; out: Record<string, unknown> };
export type Step<I> = { name: string; run: (ctx: StepCtx<I>) => Promise<unknown> };
export type WorkflowDef<I> = { kind: string; steps: Step<I>[] };

const registry = new Map<string, WorkflowDef<never>>();
export function defineWorkflow<I>(def: WorkflowDef<I>) {
  registry.set(def.kind, def as unknown as WorkflowDef<never>);
  return def;
}

export async function startWorkflow<I>(def: WorkflowDef<I>, input: I, opts: { orgId: string; createdBy?: string }) {
  const r = await withSystem((db) =>
    one<{ id: string }>(db, "insert into workflow_runs (org_id, kind, input, created_by) values ($1,$2,$3,$4) returning id", [opts.orgId, def.kind, JSON.stringify(input), opts.createdBy ?? null]),
  );
  return r!.id;
}

export async function runWorkflow(id: string): Promise<{ status: string; error?: string; out?: Record<string, unknown> }> {
  // Claim the run (lease) so two workers never execute it at once.
  const run = await withSystem((db) =>
    one<{ id: string; org_id: string; kind: string; input: unknown; attempts: number }>(db,
      `update workflow_runs set status='running', locked_until = now() + interval '3 minutes', attempts = attempts + 1, updated_at = now()
       where id = $1 and status in ('queued','running','failed') and (locked_until is null or locked_until < now()) returning id, org_id, kind, input, attempts`, [id]),
  );
  if (!run) return { status: "locked" };
  const def = registry.get(run.kind);
  if (!def) throw new Error(`Unknown workflow ${run.kind}`);
  const done = await withSystem((db) => rows<{ name: string; output: unknown }>(db, "select name, output from workflow_steps where workflow_run_id = $1 and status = 'completed'", [id]));
  const out: Record<string, unknown> = Object.fromEntries(done.map((d) => [d.name, d.output]));

  for (const step of def.steps) {
    if (step.name in out) continue;
    await withSystem((db) => db.query(
      `insert into workflow_steps (org_id, workflow_run_id, name, status) values ($1,$2,$3,'running')
       on conflict (workflow_run_id, name) do update set status='running', attempts = workflow_steps.attempts + 1, started_at = now(), error = null`, [run.org_id, id, step.name]));
    await withSystem((db) => db.query("update workflow_runs set current_step = $2, updated_at = now() where id = $1", [id, step.name]));
    try {
      const result = (await step.run({ runId: id, orgId: run.org_id, input: run.input as never, out })) ?? null;
      out[step.name] = result;
      await withSystem((db) => db.query("update workflow_steps set status='completed', output=$3, finished_at=now() where workflow_run_id=$1 and name=$2", [id, step.name, JSON.stringify(result)]));
    } catch (e) {
      const msg = (e as Error).message.slice(0, 1000);
      const final = run.attempts >= 3;
      await withSystem(async (db) => {
        await db.query("update workflow_steps set status='failed', error=$3, finished_at=now() where workflow_run_id=$1 and name=$2", [id, step.name, msg]);
        await db.query(`update workflow_runs set status=$2, error=$3, locked_until=null, next_run_at = now() + ($4 || ' seconds')::interval, updated_at=now() where id=$1`,
          [id, final ? "failed" : "queued", `${step.name}: ${msg}`, String(30 * 2 ** run.attempts)]);
      });
      return { status: final ? "failed" : "queued", error: `${step.name}: ${msg}` };
    }
  }
  await withSystem((db) => db.query("update workflow_runs set status='completed', state=$2, current_step=null, error=null, locked_until=null, updated_at=now() where id=$1", [id, JSON.stringify(out)]));
  return { status: "completed", out };
}

/** Worker tick: resume due runs (called by cron). */
export async function tick(limit = 5) {
  const due = await withSystem((db) => rows<{ id: string }>(db, "select id from workflow_runs where status = 'queued' and next_run_at <= now() order by next_run_at limit $1", [limit]));
  const results = [];
  for (const d of due) results.push({ id: d.id, ...(await runWorkflow(d.id)) });
  return results;
}
