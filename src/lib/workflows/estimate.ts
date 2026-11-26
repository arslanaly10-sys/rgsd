import "server-only";
import { one, rows, withSystem } from "@/lib/db";
import { activeRates, price, Scope, takeoff, type Priced, type Takeoff } from "@/lib/estimating";
import { estimateCost } from "@/lib/ai/provider";
import { extractScope, type Extraction } from "@/lib/agents/extract";
import { getFile } from "@/lib/storage";
import { defineWorkflow, runWorkflow, startWorkflow } from "./engine";

type Input = { requestId: string; requestedBy: string };
type Loaded = { ref: string; text: string; siteCode: string | null; clientCompanyId: string; docs: { id: string; title: string; mime: string; path: string }[]; examples: string[] };

export const estimateWorkflow = defineWorkflow<Input>({
  kind: "estimate_request",
  steps: [
    {
      name: "load_request",
      async run({ input, orgId }): Promise<Loaded> {
        return withSystem(async (db) => {
          const r = await one<{ ref: string; title: string; description: string | null; scaffold_type: string | null; site_code: string | null; client_company_id: string }>(db,
            `select r.ref, r.title, r.description, r.scaffold_type, s.code site_code, r.client_company_id from requests r left join sites s on s.id = r.site_id where r.id = $1 and r.org_id = $2`, [input.requestId, orgId]);
          if (!r) throw new Error("Request not found");
          await db.query("update requests set status = 'estimating' where id = $1 and status in ('new','triage')", [input.requestId]);
          const docs = await rows<{ id: string; title: string; mime: string; path: string }>(db,
            "select id, title, mime, storage_path path from documents where entity_type = 'request' and entity_id = $1 and storage_path is not null order by created_at", [input.requestId]);
          const ex = await rows<{ note: string | null; output: unknown; corrected_output: unknown }>(db,
            "select note, output, corrected_output from agent_examples where org_id = $1 and agent = 'estimator' order by created_at desc limit 3", [orgId]);
          return {
            ref: r.ref, text: [r.title, r.description, r.scaffold_type ? `Type: ${r.scaffold_type}` : ""].filter(Boolean).join("\n"), siteCode: r.site_code, clientCompanyId: r.client_company_id, docs,
            examples: ex.map((e) => `- ${e.note ?? "Correction"}: AI ${JSON.stringify(e.output).slice(0, 300)} → estimator ${JSON.stringify(e.corrected_output).slice(0, 300)}`),
          };
        });
      },
    },
    {
      name: "extract_scope",
      async run({ out, input, orgId, runId }) {
        const l = out.load_request as Loaded;
        const docs = await Promise.all(l.docs.map(async (d) => ({ title: d.title, mime: d.mime, data: await getFile(d.path) })));
        const t0 = Date.now();
        const x: Extraction = await extractScope({ requestText: l.text, siteCode: l.siteCode, docs, examples: l.examples });
        // Trace as an Estimator agent run so tokens, cost and output show in AI agents.
        await withSystem((db) => db.query(
          `insert into agent_runs (org_id, user_id, client_company_id, agent, channel, status, input, output, model, mode, tokens_in, tokens_out, cost_usd, latency_ms, workflow_run_id, prompt_version, completed_at)
           values ($1,$2,$3,'estimator','workflow','completed',$4,$5,$6,$7,$8,$9,$10,$11,$12,'extract-v1',now())`,
          [orgId, input.requestedBy, l.clientCompanyId, JSON.stringify({ text: `Extract scope for ${l.ref} (${l.docs.length} document(s))` }), JSON.stringify({ summary: `${x.scope.items.length} item(s), confidence ${x.scope.confidence}`, scope: x.scope, notes: x.notes }),
           x.model, x.mode, x.usage.input, x.usage.output, estimateCost(x.model, x.usage.input, x.usage.output), Date.now() - t0, runId]));
        return { scope: x.scope, notes: x.notes, mode: x.mode };
      },
    },
    {
      name: "takeoff",
      async run({ out, orgId }) {
        return takeoff(orgId, Scope.parse((out.extract_scope as { scope: unknown }).scope));
      },
    },
    {
      name: "price",
      async run({ out, orgId }) {
        return price(Scope.parse((out.extract_scope as { scope: unknown }).scope), out.takeoff as Takeoff, await activeRates(orgId));
      },
    },
    {
      name: "draft_quote",
      async run({ out, input, orgId, runId }) {
        const l = out.load_request as Loaded;
        const { scope, notes } = out.extract_scope as { scope: Scope; notes: string[] };
        const p = out.price as Priced;
        const t = out.takeoff as Takeoff;
        return withSystem(async (db) => {
          const ref = await one<{ ref: string }>(db, `select 'QT-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from quotes where org_id = $1`, [orgId]);
          // Client-facing assumptions only. Stock shortages and extraction notes are internal (shown in the editor and the agent trace).
          const assumptions = scope.assumptions;
          void notes;
          const q = await one<{ id: string }>(db,
            `insert into quotes (org_id, client_company_id, request_id, ref, status, kind, subtotal, vat, total, valid_until, assumptions, prepared_by, ai_generated, ai_confidence, scope, takeoff, workflow_run_id, questions)
             values ($1,$2,$3,$4,'draft','firm',$5,$6,$7, current_date + 30, $8, $9, true, $10, $11, $12, $13, $14) returning id`,
            [orgId, l.clientCompanyId, input.requestId, ref!.ref, p.subtotal, p.vat, p.total, assumptions.join("\n"), input.requestedBy, scope.confidence, JSON.stringify(scope), JSON.stringify(t), runId, scope.questions]);
          let i = 0;
          for (const line of p.lines) {
            await db.query("insert into quote_lines (org_id, quote_id, rate_item_id, description, description_ar, qty, unit, rate, amount, sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
              [orgId, q!.id, line.rate_item_id, line.description, line.description_ar, line.qty, line.unit, line.rate, line.amount, i++]);
          }
          await db.query("update requests set ai_summary = $2, workflow_run_id = $3 where id = $1", [input.requestId, JSON.stringify({ items: scope.items.length, confidence: scope.confidence, questions: scope.questions, quote_ref: ref!.ref }), runId]);
          await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) values ($1,'estimator','quote_draft',$2,$3,$4)",
            [orgId, `AI drafted ${ref!.ref} for ${l.ref}: review and submit`, `أعدّ الذكاء الاصطناعي ${ref!.ref} للطلب ${l.ref}`, `/ops/quotes/${q!.id}`]);
          return { quoteId: q!.id, ref: ref!.ref, total: p.total };
        });
      },
    },
  ],
});

/** Start and run inline (fast enough for one request); the cron tick resumes it if it stops part-way. */
export async function estimateRequest(orgId: string, requestId: string, requestedBy: string) {
  const id = await startWorkflow(estimateWorkflow, { requestId, requestedBy }, { orgId, createdBy: requestedBy });
  const r = await runWorkflow(id);
  return { workflowRunId: id, ...r, quote: r.out?.draft_quote as { quoteId: string; ref: string; total: number } | undefined };
}
