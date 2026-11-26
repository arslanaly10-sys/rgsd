import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Bar, health } from "@/components/delivery/views";
import { requireSession } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import { fmtDate, fmtNum, fmtSAR } from "@/lib/format";
import { getProject, listAreas, listDependencies, listMilestones, listSignoffs } from "@/lib/projects";
import { SERVICE_META } from "@/lib/service-lines";

/** Bilingual weekly progress report (EN | AR), printable. RLS: clients only see their own projects. */
export default async function WeeklyReport({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await getProject(s, id);
  if (!p) notFound();
  const [areas, ms, deps, sos, week] = await Promise.all([
    listAreas(s, id), listMilestones(s, id), listDependencies(s, id), listSignoffs(s, { projectId: id, status: "pending" }),
    withUser(s, (db) => rows<{ code: string; name: string; uom: string; qty: string; days: number }>(db,
      `select a.code, a.name, a.uom, sum(e.qty) qty, count(distinct e.entry_date)::int days from progress_entries e join project_areas a on a.id = e.area_id
       where e.project_id = $1 and e.entry_date > current_date - 7 group by 1,2,3 order by 1`, [id])),
  ]);
  const h = health(p);
  const to = new Date(), from = new Date(Date.now() - 6 * 86400000);
  const H = ({ en, ar }: { en: string; ar: string }) => <h2 className="mt-6 flex items-baseline justify-between border-b border-line pb-1 text-sm font-semibold"><span>{en}</span><span dir="rtl">{ar}</span></h2>;
  return (
    <div className="min-h-dvh bg-canvas px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[900px] items-center justify-between print:hidden">
        <Link href={`${s.isStaff ? "/ops" : "/client"}/projects/${id}`} className="text-sm text-muted hover:text-ink">← Back</Link>
        <PrintButton label="Print / Save PDF" />
      </div>
      <article className="mx-auto max-w-[900px] rounded-xl border border-line bg-white p-6 text-[13px] text-ink sm:p-10 print:border-0 print:p-0" dir="ltr">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-brand pb-4">
          <div className="flex items-center gap-3"><Image src="/brand/rgs-logo.png" alt="RGS" width={48} height={48} /><div><div className="font-display text-lg font-semibold">Weekly Progress Report</div><div className="text-xs text-muted">{fmtDate(from, "en")} – {fmtDate(to, "en")}</div></div></div>
          <div className="text-end" dir="rtl"><div className="text-lg font-semibold">تقرير التقدم الأسبوعي</div><div className="text-xs text-muted">{fmtDate(from, "ar")} – {fmtDate(to, "ar")}</div></div>
        </header>
        <section className="mt-4 grid gap-1">
          <div className="font-mono text-xs">{p.ref}</div>
          <div className="text-base font-semibold">{p.name}</div>
          {p.name_ar && <div className="text-base font-semibold" dir="rtl">{p.name_ar}</div>}
          <div className="text-xs text-muted">{p.client}{p.consultant_name ? ` · Consultant: ${p.consultant_name}` : ""} · PO {p.po_number ?? "—"} · {p.service_lines.map((x) => SERVICE_META[x].en).join(" · ")}</div>
        </section>
        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Installed / المنجز", `${p.progress_pct}%`], ["Time elapsed / المدة", `${p.time_pct}%`], ["Status / الحالة", h.en], ["Certified / المعتمد", fmtSAR(p.certified_value, "en")]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-canvas p-3"><div className="text-[11px] text-muted">{k}</div><div className="font-display text-lg font-semibold tabular">{v}</div></div>
          ))}
        </section>
        <H en="Progress by area" ar="التقدم حسب المنطقة" />
        <table className="mt-2 w-full border-collapse text-[12px]">
          <thead><tr className="text-start text-[11px] text-muted"><th className="py-1 text-start">Area</th><th className="py-1 text-end">BOQ</th><th className="py-1 text-end">Installed</th><th className="w-40 py-1 ps-3 text-start">%</th><th className="py-1 text-end">Certified</th></tr></thead>
          <tbody>{areas.map((a) => { const pc = a.boq_qty ? Math.round((a.installed_qty / a.boq_qty) * 100) : 0; return (
            <tr key={a.id} className="border-t border-line"><td className="py-1.5"><span className="font-mono">{a.code}</span> {a.name}<div className="text-[11px] text-muted" dir="rtl">{a.name_ar}</div></td><td className="text-end tabular">{fmtNum(a.boq_qty, "en")} {a.uom}</td><td className="text-end tabular">{fmtNum(a.installed_qty, "en")}</td><td className="ps-3"><Bar value={pc} /><span className="text-[11px] tabular">{pc}%</span></td><td className="text-end tabular">{fmtNum(a.approved_qty, "en")}</td></tr>); })}</tbody>
        </table>
        <H en="This week" ar="هذا الأسبوع" />
        {week.length ? <ul className="mt-2 grid gap-1">{week.map((w) => <li key={w.code}><span className="font-mono">{w.code}</span> {w.name}: <strong className="tabular">+{fmtNum(w.qty, "en")} {w.uom}</strong> over {w.days} working day(s)</li>)}</ul> : <p className="mt-2 text-muted">No progress reported this week.</p>}
        <H en="Milestones" ar="المراحل" />
        <ul className="mt-2 grid gap-1">{ms.map((m) => <li key={m.id} className="flex justify-between gap-3"><span>{m.name} <span className="text-muted" dir="rtl">{m.name_ar}</span></span><span className="tabular">{m.status === "achieved" ? `Achieved ${fmtDate(m.achieved_at, "en")}` : `Due ${fmtDate(m.due_date, "en")}${m.forecast_date && m.forecast_date > m.due_date ? ` · forecast ${fmtDate(m.forecast_date, "en")}` : ""}`}</span></li>)}</ul>
        <H en="Open dependencies" ar="الاعتماديات المفتوحة" />
        <ul className="mt-2 grid gap-1">{deps.filter((d) => d.status !== "met" && d.status !== "waived").map((d) => <li key={d.id}>• [{d.owner_side === "client" ? "Client" : "RGS"}] {d.description}{d.due_date ? ` (needed ${fmtDate(d.due_date, "en")})` : ""} · <strong>{d.status}</strong></li>)}</ul>
        <H en="Waiting for client signature" ar="بانتظار توقيع العميل" />
        {sos.length ? <ul className="mt-2 grid gap-1">{sos.map((so) => <li key={so.id}>• {so.title}{so.amount ? ` · ${fmtSAR(so.amount, "en")}` : ""}{so.due_date ? ` · due ${fmtDate(so.due_date, "en")}` : ""}</li>)}</ul> : <p className="mt-2 text-muted">None.</p>}
        <footer className="mt-8 border-t border-line pt-3 text-[11px] text-muted">Resa Gulf Scaffolding · generated by RGS OneSite from site reports · SAMPLE data</footer>
      </article>
    </div>
  );
}
