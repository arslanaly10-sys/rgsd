import "server-only";
import { rows, withSystem } from "@/lib/db";
import type { Session } from "@/lib/auth";

/* The chain of work passed between agents and people, e.g. client request → tender agent → approval → client. */

export async function recordHandoff(x: { orgId: string; clientCompanyId: string | null; chain: string; from: string; to: string; action: string; link?: string; status?: "done" | "waiting" | "approved" | "rejected" }) {
  await withSystem(async (db) => {
    // Close the previous waiting step on this chain.
    await db.query("update agent_handoffs set status = 'done' where chain = $1 and status = 'waiting'", [x.chain]);
    await db.query(`insert into agent_handoffs (org_id, client_company_id, chain, step, from_label, to_label, action, link, status)
      values ($1,$2,$3, coalesce((select max(step) from agent_handoffs where chain = $3), 0) + 1, $4,$5,$6,$7,$8)`,
      [x.orgId, x.clientCompanyId, x.chain, x.from, x.to, x.action, x.link ?? null, x.status ?? "done"]);
  });
}

export type Handoff = { chain: string; step: number; from_label: string; to_label: string; action: string; link: string | null; status: string; created_at: string };

export async function listChain(s: Session, chain: string) {
  return withSystem((db) => rows<Handoff>(db, "select chain, step, from_label, to_label, action, link, status, created_at::text from agent_handoffs where chain = $1 and org_id = $2 and ($3::uuid is null or client_company_id = $3) order by step", [chain, s.orgId, s.isStaff ? null : s.clientCompanyId]));
}

export async function recentChains(s: Session) {
  return withSystem((db) => rows<{ chain: string; steps: number; last: string; title: string | null; ref: string | null; status: string }>(db,
    `select h.chain, count(*)::int steps, max(h.created_at)::text last, r.title, r.ref,
            (array_agg(h.status order by h.step desc))[1] status
     from agent_handoffs h left join requests r on h.chain = 'request:' || r.id
     where h.org_id = $1 and ($2::uuid is null or h.client_company_id = $2) group by h.chain, r.title, r.ref order by max(h.created_at) desc limit 30`, [s.orgId, s.isStaff ? null : s.clientCompanyId]));
}

/** Chain for a quote (by id or ref): its request, company and value. */
export async function quoteChain(idOrRef: string) {
  return withSystem(async (db) => (await rows<{ id: string; ref: string; request_id: string | null; client_company_id: string; total: string; org_id: string }>(db,
    "select id, ref, request_id, client_company_id, total, org_id from quotes where id::text = $1 or ref = $1 limit 1", [idOrRef]))[0] ?? null);
}
export const sarText = (n: number | string) => `SAR ${Math.round(Number(n)).toLocaleString("en")}`;
