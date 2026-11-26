import "server-only";
import type { Session } from "@/lib/auth";
import { getSessionById } from "@/lib/auth";
import { one, withSystem } from "@/lib/db";
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
    const a = await withSystem((db) =>
      one<{ id: string }>(db,
        `insert into approval_requests (org_id, client_company_id, run_id, tool, tier, summary, summary_ar, payload, approver_roles, requested_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [ctx.session.orgId, ctx.session.clientCompanyId, ctx.runId, name, policy.tier, d.en, d.ar, JSON.stringify({ input }), policy.approver_roles, ctx.session.id]),
    );
    await withSystem((db) =>
      db.query("insert into notifications (org_id, role, kind, title, title_ar, link) select $1, unnest($2::text[]), 'approval', $3, $4, '/ops/approvals'", [ctx.session.orgId, policy.approver_roles, `Approval needed: ${d.en}`, `مطلوب موافقة: ${d.ar}`]),
    );
    return {
      kind: "approval", tier: policy.tier, approvalId: a!.id,
      output: { status: "pending_approval", approval_id: a!.id, brief_en: `Queued for approval (tier ${policy.tier}): ${d.en}. ${policy.approver_roles.map((r) => r.replace(/_/g, " ")).join(" or ")} will review it.`, brief_ar: `أُرسل للموافقة (المستوى ${policy.tier}): ${d.ar}.` },
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
    one<{ id: string; tool: string; status: string; payload: { input: Record<string, unknown> }; approver_roles: string[]; requested_by: string | null; run_id: string | null; org_id: string }>(db,
      "select id, tool, status, payload, approver_roles, requested_by, run_id, org_id from approval_requests where id = $1", [id]),
  );
  if (!a || a.org_id !== approver.orgId) throw new Error("Approval not found");
  if (a.status !== "pending") throw new Error(`Already ${a.status}`);
  if (!a.approver_roles.includes(approver.role) && approver.role !== "admin") throw new Error("Your role can't approve this");
  if (a.requested_by === approver.id && approver.role !== "admin") throw new Error("You can't approve your own request");

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
    return { status: failed ? ("failed" as const) : ("executed" as const), output: out };
  } catch (e) {
    await withSystem((db) => db.query("update approval_requests set status='failed', result=$2 where id=$1", [id, JSON.stringify({ error: String(e) })]));
    return { status: "failed" as const };
  }
}
