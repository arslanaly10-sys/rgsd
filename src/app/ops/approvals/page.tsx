import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, PageHeader, Pill, statusTone } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import { fmtDate, type Loc } from "@/lib/format";
import { decide } from "./actions";

type A = { id: string; tool: string; tier: number; summary: string; summary_ar: string | null; status: string; approver_roles: string[]; created_at: string; decided_at: string | null; decision_note: string | null; run_id: string | null; requester: string | null; requester_role: string | null; decider: string | null; result: { brief_en?: string } | null };

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const { msg } = await searchParams;
  const list = await withUser(s, (db) =>
    rows<A>(db, `select a.id, a.tool, a.tier, a.summary, a.summary_ar, a.status, a.approver_roles, a.created_at, a.decided_at, a.decision_note, a.run_id, a.result,
                        p.full_name requester, p.role requester_role, d.full_name decider
                 from approval_requests a left join profiles p on p.id = a.requested_by left join profiles d on d.id = a.decided_by
                 order by (a.status = 'pending') desc, a.created_at desc limit 50`),
  );
  const mine = (a: A) => a.status === "pending" && (a.approver_roles.includes(s.role) || s.role === "admin");
  return (
    <>
      <PageHeader title={t("nav.approvals")} sub={t("pages.approvalsSub")} />
      {msg && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${msg.startsWith("ok:") ? "bg-tag-green-bg text-tag-green" : "bg-tag-red-bg text-tag-red"}`}>{msg.slice(msg.indexOf(":") + 1)}</div>
      )}
      {list.length === 0 ? (
        <Card><p className="py-6 text-center text-sm text-muted">{t("approvals.empty")}</p></Card>
      ) : (
        <div className="grid gap-3">
          {list.map((a) => (
            <Card key={a.id} className={mine(a) ? "border-brand/50" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="dark">{a.tool}</Pill>
                    <Pill tone={a.tier >= 3 ? "red" : "yellow"}>{t("approvals.tier", { tier: a.tier })}</Pill>
                    <Pill tone={statusTone(a.status)}>{t(`status.${a.status}`)}</Pill>
                  </div>
                  <p className="mt-2 font-medium">{l === "ar" && a.summary_ar ? a.summary_ar : a.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {a.requester ? `${a.requester} (${t(`roles.${a.requester_role}`)}) via AI agent` : "AI agent"} · {fmtDate(a.created_at, l)} · approvers: {a.approver_roles.map((r) => t(`roles.${r}`)).join(", ")}
                    {a.run_id && <> · <Link className="text-brand" href={`/ops/agents/runs/${a.run_id}`}>{t("agentsPage.trace")}</Link></>}
                  </p>
                  {a.decider && <p className="mt-1 text-xs text-muted">{t(`status.${a.status}`)} by {a.decider}{a.decision_note ? `: “${a.decision_note}”` : ""}{a.result?.brief_en ? ` → ${a.result.brief_en}` : ""}</p>}
                </div>
                {mine(a) && (
                  <form action={decide} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <input type="hidden" name="id" value={a.id} />
                    <input id={`note-${a.id}`} name="note" placeholder="Note (optional)" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm sm:w-48" />
                    <button name="decision" value="rejected" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-canvas">{t("approvals.reject")}</button>
                    <button name="decision" value="approved" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600">{t("approvals.approve")}</button>
                  </form>
                )}
                {a.status === "pending" && !mine(a) && <span className="text-xs text-muted">Waiting for {a.approver_roles.map((r) => t(`roles.${r}`)).join(" / ")}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
