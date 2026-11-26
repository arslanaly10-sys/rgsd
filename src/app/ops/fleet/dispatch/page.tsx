import Link from "next/link";
import { Card, Flash, Mono, PageHeader, Pill, statusTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import type { Plan } from "@/lib/fleet";
import { planDispatchAction, submitDispatchAction } from "@/lib/actions/fleet";

export default async function Dispatch({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const { msg } = await searchParams;
  const plans = await withUser(s, (db) => rows<{ id: string; plan_date: string; status: string; plan: Plan; created_at: string; pending: boolean }>(db,
    `select p.id, p.plan_date::text, p.status, p.plan, p.created_at,
            exists (select 1 from approval_requests a where a.tool = 'approve_dispatch_plan' and a.payload->'input'->>'plan_id' = p.id::text and a.status = 'pending') pending
     from dispatch_plans p order by p.created_at desc limit 5`));
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  return (
    <>
      <Link href="/ops/fleet" className="text-sm text-muted hover:text-ink">← Fleet & logistics</Link>
      <PageHeader title="Dispatch planner" sub="The Fleet agent loads trucks by weight, orders stops by distance from the Dammam yard, keeps night-only sites on night trips and routes offshore work via the Tanajib boat transfer."
        actions={<form action={planDispatchAction} className="flex items-center gap-2"><label htmlFor="date" className="sr-only">Date</label><input id="date" name="date" type="date" defaultValue={tomorrow} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm" /><SubmitButton className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white" pending="Planning…">Plan the day</SubmitButton></form>} />
      <Flash msg={msg} />
      {plans.length === 0 && <Card><p className="py-6 text-center text-sm text-muted">No plans yet. Pick a date and plan the day.</p></Card>}
      <div className="grid gap-4">
        {plans.map((p) => (
          <Card key={p.id} title={`Plan for ${p.plan_date} · ${p.plan.trips.length} trip(s)`} action={<span className="flex items-center gap-2">{p.pending && <Pill tone="yellow">awaiting approval</Pill>}<Pill tone={statusTone(p.status)}>{p.status}</Pill></span>}>
            <div className="grid gap-3 md:grid-cols-2">
              {p.plan.trips.map((t, k) => (
                <div key={k} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Trip {k + 1} · <span dir="rtl">{t.vehicle.plate}</span></span>
                    <span className="flex gap-1"><Pill tone={t.window === "night" ? "dark" : "neutral"}>{t.window}</Pill><Pill tone={t.utilisation > 90 ? "yellow" : "green"}>{t.utilisation}% load</Pill></span>
                  </div>
                  <p className="text-xs text-muted">{t.vehicle.kind} · {t.vehicle.driver ?? "driver tbc"} · {(t.load_kg / 1000).toFixed(1)} t of {(t.vehicle.capacity_kg / 1000).toFixed(0)} t · ~{t.est_km} km · {t.est_hours} h</p>
                  <ol className="mt-2 grid gap-1 text-sm">
                    <li className="text-xs text-muted">Dammam yard</li>
                    {t.stops.map((st, j) => (
                      <li key={j}>→ <strong>{st.kind === "delivery" ? "Deliver" : "Collect"}</strong> <Mono>{st.site_code}</Mono>{st.via ? <span className="text-xs text-muted"> via {st.via}</span> : null} <span className="text-xs text-muted">({(st.kg / 1000).toFixed(1)} t: {st.lines.map((l) => `${l.sku}×${l.qty}`).join(", ")})</span></li>
                    ))}
                    <li className="text-xs text-muted">→ back to yard</li>
                  </ol>
                </div>
              ))}
            </div>
            {p.plan.warnings.length > 0 && <ul className="mt-3 grid gap-1 rounded-lg bg-tag-yellow-bg p-3 text-sm text-tag-yellow">{p.plan.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>}
            {p.status === "draft" && !p.pending && (
              <form action={submitDispatchAction} className="mt-3 flex justify-end"><input type="hidden" name="id" value={p.id} /><SubmitButton className="rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white" pending="Submitting…">Submit for approval</SubmitButton></form>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
