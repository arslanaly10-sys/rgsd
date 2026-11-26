import "server-only";
import type { Session } from "@/lib/auth";
import { getSessionById } from "@/lib/auth";
import { one, rows, withSystem } from "@/lib/db";
import { POSITION } from "@/lib/positions";
import { TOOLS, type ToolCtx, type ToolName, type ToolOutput } from "./tools";

export type Policy = { tool: string; tier: number; allowed_roles: string[]; auto_roles: string[]; approver_roles: string[]; description: string | null };

export type InvokeResult =
  | { kind: "result"; tier: number; output: ToolOutput }
  | { kind: "approval"; tier: number; approvalId: string; output: ToolOutput }
  | { kind: "denied" | "invalid" | "error"; tier: number; output: ToolOutput };

async function loadPolicy(orgId: string, tool: string) {
  return withSystem((db) => one<Policy>(db, "select tool, tier, allowed_roles, auto_roles, approver_roles, description from agent_policies where org_id = $1 and tool = $2", [orgId, tool]));
}

export async function allowedTools(session: Session, candidates: readonly ToolName[]): Promise<ToolName[]> {
  const ps = await withSystem((db) =>
    db.query<{ tool: string }>("select tool from agent_policies where org_id = $1 and $2 = any(allowed_roles) and tool = any($3)", [session.orgId, session.role, candidates as string[]]),
  );
  const ok = new Set(ps.rows.map((r) => r.tool));
  return candidates.filter((c) => ok.has(c));
}

const describeApproval = (tool: string, input: Record<string, unknown>) => {
  const v = (k: string) => (input[k] != null ? String(input[k]) : "");
  switch (tool) {
    case "send_quote": return { en: `Send quote ${v("quote_ref")} to the client`, ar: `إرسال العرض ${v("quote_ref")} إلى العميل` };
    case "set_tag_status": return { en: `Change tag ${v("tag_no")} to ${v("status").toUpperCase()}${input.restrictions ? ` (${v("restrictions")})` : ""}${input.reason ? `: ${v("reason")}` : ""}`, ar: `تغيير بطاقة ${v("tag_no")} إلى ${v("status")}` };
    case "request_off_hire": return { en: `Off-hire material at ${v("site_code")}${input.sku ? ` (${v("sku")})` : ""}${input.note ? `: ${v("note")}` : ""}`, ar: `إنهاء إيجار المواد في ${v("site_code")}` };
    default: return { en: `${tool} ${JSON.stringify(input)}`, ar: `${tool}` };
  }
};

// Money-bearing tools: what they are worth decides who may approve (approval_limits by position).
const MONEY: Record<string, { kind: string; sql: string; key: string }> = {
  send_quote: { kind: "quote", sql: "select subtotal::float8 v from quotes where ref = $1 and org_id = $2", key: "quote_ref" },
  issue_credit_note: { kind: "credit_note", sql: "select subtotal::float8 v from credit_notes where ref = $1 and org_id = $2", key: "ref" },
  issue_invoice: { kind: "invoice", sql: "select subtotal::float8 v from invoices where ref = $1 and org_id = $2", key: "invoice_ref" },
};
export async function approvalRouting(orgId: string, tool: string, input: Record<string, unknown>) {
  const m = MONEY[tool];
  if (!m) return { amount: null as number | null, positions: null as string[] | null, kind: null as string | null };
  return withSystem(async (db) => {
    const v = (await one<{ v: number }>(db, m.sql, [String(input[m.key] ?? ""), orgId]))?.v ?? null;
    if (v == null) return { amount: null, positions: null, kind: m.kind };
    const lim = await rows<{ position: string; max_amount: string | null }>(db, "select position, max_amount from approval_limits where org_id = $1 and kind = $2", [orgId, m.kind]);
    if (!lim.length) return { amount: v, positions: null, kind: m.kind };
    const ok = lim.filter((l) => l.max_amount == null || Number(l.max_amount) >= v).map((l) => l.position);
    return { amount: v, positions: ok, kind: m.kind };
  });
}
const positionNames = (ps: string[]) => ps.map((p) => POSITION[p]?.en ?? p).join(" or ");

/**
 * The only way an agent can act. Validates input, checks the role may use the tool,
 * and applies the risk tier: T0/T1 run; T2 runs for trusted roles, else needs approval; T3 always needs approval.
 */
export async function invokeTool(ctx: ToolCtx, name: string, rawInput: unknown): Promise<InvokeResult> {
  const tool = (TOOLS as Record<string, (typeof TOOLS)[ToolName]>)[name];
  if (!tool) return { kind: "invalid", tier: 0, output: { error: "unknown_tool", brief_en: `Unknown tool ${name}.`, brief_ar: `أداة غير معروفة ${name}.` } };
  const policy = await loadPolicy(ctx.session.orgId, name);
  if (!policy || !policy.allowed_roles.includes(ctx.session.role)) {
    return { kind: "denied", tier: policy?.tier ?? 3, output: { error: "not_permitted", brief_en: `Your role can't use ${name}. Ask an RGS operations manager.`, brief_ar: `لا يسمح دورك باستخدام ${name}.` } };
  }
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { kind: "invalid", tier: policy.tier, output: { error: "invalid_input", issues: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`), brief_en: "I need a bit more detail to do that.", brief_ar: "أحتاج إلى مزيد من التفاصيل." } };
  }
  const input = parsed.data as Record<string, unknown>;
  const needsApproval = policy.tier >= 3 || (policy.tier === 2 && !policy.auto_roles.includes(ctx.session.role));
  if (needsApproval) {
    const d = describeApproval(name, input);
    const route = await approvalRouting(ctx.session.orgId, name, input);
    const summary = route.amount != null ? `${d.en} (SAR ${route.amount.toLocaleString("en")})` : d.en;
    const a = await withSystem((db) =>
      one<{ id: string }>(db,
        `insert into approval_requests (org_id, client_company_id, run_id, tool, tier, summary, summary_ar, payload, approver_roles, requested_by, amount, approver_positions)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [ctx.session.orgId, ctx.session.clientCompanyId, ctx.runId, name, policy.tier, summary, d.ar, JSON.stringify({ input }), policy.approver_roles, ctx.session.id, route.amount, route.positions]),
    );
    await withSystem(async (db) => {
      if (route.positions?.length) {
        // Notify the people whose limit covers this amount.
        await db.query(`insert into notifications (org_id, user_id, kind, title, title_ar, link) select $1, p.id, 'approval', $3, $4, '/ops/approvals' from profiles p
          where p.org_id = $1 and p.status = 'active' and p.position = any($2::text[]) and p.id <> $5`, [ctx.session.orgId, route.positions, `Approval needed: ${summary}`, `مطلوب موافقة: ${d.ar}`, ctx.session.id]);
      } else {
        await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest($2::text[]), 'approval', $3, $4, '/ops/approvals'", [ctx.session.orgId, policy.approver_roles, `Approval needed: ${summary}`, `مطلوب موافقة: ${d.ar}`]);
      }
    });
    const who = route.positions?.length ? positionNames(route.positions.filter((p) => POSITION[p]?.side === "rgs")) : policy.approver_roles.map((r) => r.replace(/_/g, " ")).join(" or ");
    return {
      kind: "approval", tier: policy.tier, approvalId: a!.id,
      output: { status: "pending_approval", approval_id: a!.id, amount: route.amount, approver_positions: route.positions, brief_en: `Queued for approval (tier ${policy.tier}): ${summary}. ${who} will review it.`, brief_ar: `أُرسل للموافقة (المستوى ${policy.tier}): ${d.ar}.` },
    };
  }
  try {
    return { kind: "result", tier: policy.tier, output: await tool.run(ctx, parsed.data as never) };
  } catch (e) {
    console.error(`[tool ${name}]`, e);
    return { kind: "error", tier: policy.tier, output: { error: "tool_failed", brief_en: `Something went wrong running ${name}. The error is logged for the team.`, brief_ar: `حدث خطأ أثناء تنفيذ ${name}.` } };
  }
}

/** Approve or reject a queued action. Approved actions run on behalf of the original requester, with the approver recorded. */
export async function decideApproval(approver: Session, id: string, decision: "approved" | "rejected", note?: string) {
  const a = await withSystem((db) =>
    one<{ id: string; tool: string; status: string; payload: { input: Record<string, unknown> }; approver_roles: string[]; requested_by: string | null; run_id: string | null; org_id: string; amount: string | null; approver_positions: string[] | null }>(db,
      "select id, tool, status, payload, approver_roles, requested_by, run_id, org_id, amount, approver_positions from approval_requests where id = $1", [id]),
  );
  if (!a || a.org_id !== approver.orgId) throw new Error("Approval not found");
  if (a.status !== "pending") throw new Error(`Already ${a.status}`);
  if (!a.approver_roles.includes(approver.role) && approver.role !== "admin") throw new Error("Your role can't approve this");
  if (a.requested_by === approver.id && approver.role !== "admin") throw new Error("You can't approve your own request");
  if (decision === "approved" && a.approver_positions?.length && approver.role !== "admin" && !a.approver_positions.includes(approver.position)) {
    throw new Error(`SAR ${Number(a.amount).toLocaleString("en")} is above your approval limit. ${positionNames(a.approver_positions.filter((p) => POSITION[p]?.side === "rgs"))} approves this.`);
  }

  if (decision === "rejected") {
    const r = await withSystem((db) => db.query("update approval_requests set status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 where id=$1 and status='pending'", [id, approver.id, note ?? null]));
    if (!r.rowCount) throw new Error("Someone else already decided this");
    return { status: "rejected" as const };
  }
  // Atomically claim the request so two approvers can't both execute it.
  const claimed = await withSystem((db) => db.query("update approval_requests set status='approved', decided_by=$2, decided_at=now(), decision_note=$3 where id=$1 and status='pending'", [id, approver.id, note ?? null]));
  if (!claimed.rowCount) throw new Error("Someone else already decided this");
  const requester = a.requested_by ? await getSessionById(a.requested_by) : null;
  const ctx: ToolCtx = { session: requester ?? approver, runId: a.run_id, locale: approver.locale };
  const tool = (TOOLS as Record<string, (typeof TOOLS)[ToolName]>)[a.tool];
  try {
    const out = await tool.run(ctx, tool.schema.parse(a.payload.input) as never);
    const failed = "error" in out;
    await withSystem((db) => db.query("update approval_requests set status=$2, result=$3 where id=$1", [id, failed ? "failed" : "executed", JSON.stringify(out)]));
    if (!failed && a.tool === "send_quote") {
      const { quoteChain, recordHandoff, sarText } = await import("./handoffs");
      const ch = await quoteChain(String(a.payload.input.quote_ref));
      if (ch?.request_id) await recordHandoff({ orgId: a.org_id, clientCompanyId: ch.client_company_id, chain: `request:${ch.request_id}`, from: `${approver.fullName} (${POSITION[approver.position]?.en ?? "Approver"})`, to: "Client project manager",
        action: `Approved ${ch.ref} (${sarText(ch.total)}) within their limit; quote sent to the client`, link: `/client/quotes/${ch.id}`, status: "waiting" });
    }
    return { status: failed ? ("failed" as const) : ("executed" as const), output: out };
  } catch (e) {
    await withSystem((db) => db.query("update approval_requests set status='failed', result=$2 where id=$1", [id, JSON.stringify({ error: String(e) })]));
    return { status: "failed" as const };
  }
}
