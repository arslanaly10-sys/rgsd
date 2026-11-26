import Link from "next/link";
import type { ReactNode } from "react";
import type { Session } from "@/lib/auth";
import { daysUntil, fmtDate, fmtNum, fmtSAR, type Loc } from "@/lib/format";
import { STAGES, SERVICE_META, type ServiceLine } from "@/lib/service-lines";
import type { Activity, Area, ProjectSummary, Signoff } from "@/lib/projects";
import { awaitingMe } from "@/lib/projects";
import {
  decideSignoffAction, logProgressAction, markDependencyAction, raiseInstructionAction, respondInstructionAction, submitMeasurementAction, submitVariationAction, updateMilestoneAction,
} from "@/lib/actions/delivery";
import { SubmitButton } from "../submit-button";
import { Card, Mono, Pill, Table, Td } from "../ui";

export const tx = (l: Loc, en: string, ar: string) => (l === "ar" ? ar : en);
const field = "rounded-lg border border-line bg-panel px-3 py-2 text-sm";

export function ServiceChip({ line, l }: { line: string; l: Loc }) {
  const m = SERVICE_META[line as ServiceLine];
  if (!m) return null;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: `${m.accent}1a`, color: m.accent }}><span className="size-1.5 rounded-full" style={{ background: m.accent }} />{l === "ar" ? m.ar : m.en}</span>;
}

export function Bar({ value, marker, tone = "brand" }: { value: number; marker?: number; tone?: "brand" | "green" | "red" | "ink" }) {
  const c = { brand: "bg-brand", green: "bg-tag-green", red: "bg-tag-red", ink: "bg-ink" }[tone];
  return (
    <div className="relative h-2 w-full rounded-full bg-line" role="img" aria-label={`${value}%`}>
      <div className={`h-full rounded-full ${c}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      {marker != null && <span className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ insetInlineStart: `${Math.min(100, marker)}%` }} title={`time elapsed ${marker}%`} />}
    </div>
  );
}

/** Schedule health: installed % vs time elapsed %, plus blockers. */
export function health(p: ProjectSummary): { tone: "green" | "yellow" | "red"; en: string; ar: string } {
  const gap = p.progress_pct - p.time_pct;
  if (p.blocked_deps > 0 && gap < -10) return { tone: "red", en: "At risk", ar: "معرض للخطر" };
  if (gap >= -5 && p.overdue_milestones > 0) return { tone: "yellow", en: "Milestones slipping", ar: "مراحل متأخرة" };
  if (gap < -15 || p.overdue_milestones > 1) return { tone: "red", en: "Behind", ar: "متأخر" };
  if (gap < -5 || p.overdue_milestones > 0 || p.blocked_deps > 0) return { tone: "yellow", en: "Watch", ar: "مراقبة" };
  return { tone: "green", en: "On track", ar: "في المسار" };
}

export function ProjectCards({ list, base, l }: { list: ProjectSummary[]; base: string; l: Loc }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {list.map((p) => {
        const h = health(p);
        return (
          <Link key={p.id} href={`${base}/projects/${p.id}`} className="grid gap-3 rounded-xl border border-line bg-panel p-4 transition hover:border-brand">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5"><Mono>{p.ref}</Mono>{p.service_lines.map((x) => <ServiceChip key={x} line={x} l={l} />)}</div>
                <div className="mt-1 font-medium leading-snug">{l === "ar" && p.name_ar ? p.name_ar : p.name}</div>
                <div className="text-xs text-muted">{l === "ar" && p.client_ar ? p.client_ar : p.client}</div>
              </div>
              <Pill tone={h.tone}>{tx(l, h.en, h.ar)}</Pill>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted tabular"><span>{tx(l, "Installed", "المنجز")} {p.progress_pct}%</span><span>{tx(l, "Time", "المدة")} {p.time_pct}%</span></div>
              <Bar value={p.progress_pct} marker={p.time_pct} tone={h.tone === "red" ? "red" : "brand"} />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted">{tx(l, "Revised value", "القيمة المعدلة")}</dt><dd className="font-semibold tabular">{fmtSAR(p.revised_value, l)}</dd></div>
              <div><dt className="text-muted">{tx(l, "Certified", "المعتمد")}</dt><dd className="font-semibold tabular">{fmtSAR(p.certified_value, l)}</dd></div>
              <div><dt className="text-muted">{tx(l, "Waiting", "معلق")}</dt><dd className="font-semibold tabular">{p.pending_signoffs} {tx(l, "sign-offs", "توقيع")}{p.blocked_deps ? ` · ${p.blocked_deps} ${tx(l, "blocked", "معطل")}` : ""}</dd></div>
            </dl>
          </Link>
        );
      })}
    </div>
  );
}

export function Commercials({ p, l }: { p: ProjectSummary & { retention_pct: number; advance_pct?: number }; l: Loc }) {
  const retention = (p.certified_value * Number(p.retention_pct)) / 100;
  const items: [string, number, string?][] = [
    [tx(l, "Original contract", "قيمة العقد الأصلية"), p.contract_value],
    [tx(l, "Approved variations", "أوامر التغيير المعتمدة"), p.approved_vos],
    [tx(l, "Revised contract value", "قيمة العقد المعدلة"), p.revised_value],
    [tx(l, "Installed (by RGS reports)", "المنجز (حسب تقارير RGS)"), p.installed_value],
    [tx(l, "Certified (client-signed)", "المعتمد (بتوقيع العميل)"), p.certified_value],
    [tx(l, `Retention held (${p.retention_pct}%)`, `المحتجزات (${p.retention_pct}%)`), retention],
    [tx(l, "Balance to complete", "المتبقي للإنجاز"), Math.max(0, p.revised_value - p.certified_value)],
  ];
  return (
    <dl className="grid gap-1.5 text-sm">
      {items.map(([k, v], i) => <div key={i} className={`flex justify-between gap-3 ${i === 2 ? "border-t border-line pt-1.5 font-semibold" : ""}`}><dt className="text-muted">{k}</dt><dd className="tabular">{fmtSAR(v, l)}</dd></div>)}
    </dl>
  );
}

export function AreasTable({ areas, l, staff, back }: { areas: Area[]; l: Loc; staff: boolean; back: string }) {
  return (
    <Table minWidth={staff ? 980 : 760} head={[tx(l, "Area", "المنطقة"), tx(l, "System", "النظام"), "BOQ", tx(l, "Installed", "المنجز"), tx(l, "Certified", "المعتمد"), tx(l, "Stage", "المرحلة"), ...(staff ? [tx(l, "Log today", "تسجيل اليوم")] : [])]}>
      {areas.map((a) => {
        const inst = a.boq_qty ? Math.round((a.installed_qty / a.boq_qty) * 100) : 0;
        const stages = STAGES[a.service_line];
        return (
          <tr key={a.id} className="align-top">
            <Td><div className="flex items-center gap-1.5"><Mono>{a.code}</Mono><ServiceChip line={a.service_line} l={l} /></div><div className="mt-0.5 text-sm">{l === "ar" && a.name_ar ? a.name_ar : a.name}</div><div className="text-[11px] text-muted">{a.project_ref}{a.last_entry ? ` · ${tx(l, "last report", "آخر تقرير")} ${fmtDate(a.last_entry, l)}` : ""}</div></Td>
            <Td className="max-w-[180px] text-xs text-muted">{a.system}</Td>
            <Td className="whitespace-nowrap tabular">{fmtNum(a.boq_qty, l)} {a.uom}</Td>
            <Td className="w-36"><div className="tabular text-sm">{fmtNum(a.installed_qty, l)} <span className="text-xs text-muted">({inst}%)</span></div><Bar value={inst} /></Td>
            <Td className="whitespace-nowrap tabular">{fmtNum(a.approved_qty, l)}</Td>
            <Td className="w-40"><div className="text-xs">{a.stage === "complete" ? tx(l, "Complete", "مكتمل") : a.stage === "not_started" ? tx(l, "Not started", "لم يبدأ") : (stages.find((x) => x.key === a.stage)?.[l === "ar" ? "ar" : "en"] ?? a.stage)}</div><Bar value={a.stage_pct} tone="ink" /><div className="text-[11px] text-muted tabular">{a.stage_pct}% {tx(l, "stage-weighted", "مرجح بالمراحل")}</div></Td>
            {staff && (
              <Td>
                <form action={logProgressAction} className="flex flex-wrap items-center gap-1.5">
                  <input type="hidden" name="areaId" value={a.id} /><input type="hidden" name="back" value={back} />
                  <input name="qty" type="number" step="0.01" min="0" placeholder={a.uom} aria-label={`Quantity today for ${a.code}`} className={`${field} w-20 py-1`} />
                  <select name="stage" defaultValue={a.stage} aria-label={`Stage for ${a.code}`} className={`${field} py-1 text-xs`}>
                    <option value="not_started">Not started</option>
                    {stages.map((st) => <option key={st.key} value={st.key}>{st.en}</option>)}
                    <option value="complete">Complete</option>
                  </select>
                  <input name="partial" type="number" min="0" max="100" defaultValue={50} aria-label="Percent through the stage" title="% through this stage" className={`${field} w-16 py-1`} />
                  <SubmitButton className="rounded-md bg-ink px-2.5 py-1 text-xs font-semibold text-white" pending="…">Log</SubmitButton>
                </form>
              </Td>
            )}
          </tr>
        );
      })}
    </Table>
  );
}

export function MilestoneList({ items, l, staff, back }: { items: { id: string; project_ref: string; name: string; name_ar: string | null; due_date: string; forecast_date: string | null; status: string; achieved_at: string | null; service_line: string | null }[]; l: Loc; staff: boolean; back: string }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((m) => {
        const slip = m.status === "pending" && ((m.forecast_date && m.forecast_date > m.due_date) || (daysUntil(m.due_date) ?? 0) < 0);
        return (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Mono>{m.project_ref}</Mono>{m.service_line && <ServiceChip line={m.service_line} l={l} />}<span className="font-medium">{l === "ar" && m.name_ar ? m.name_ar : m.name}</span></div>
              <div className="text-xs text-muted">{tx(l, "Committed", "الموعد الملتزم")} {fmtDate(m.due_date, l)}{m.forecast_date ? ` · ${tx(l, "forecast", "المتوقع")} ${fmtDate(m.forecast_date, l)}` : ""}{m.achieved_at ? ` · ${tx(l, "achieved", "تحقق")} ${fmtDate(m.achieved_at, l)}` : ""}</div>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={m.status === "achieved" ? "green" : slip ? "red" : "neutral"}>{m.status === "achieved" ? tx(l, "Achieved", "تحقق") : slip ? tx(l, "Slipping", "متأخر") : tx(l, "On plan", "حسب الخطة")}</Pill>
              {staff && m.status === "pending" && (
                <form action={updateMilestoneAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={m.id} /><input type="hidden" name="back" value={back} />
                  <input name="forecast" type="date" defaultValue={m.forecast_date ?? m.due_date} aria-label="Forecast date" className={`${field} py-1 text-xs`} />
                  <SubmitButton className="rounded-md border border-line px-2 py-1 text-xs font-semibold">Re-forecast</SubmitButton>
                  <SubmitButton name="achieved" value="1" className="rounded-md bg-tag-green px-2 py-1 text-xs font-semibold text-white">Achieved</SubmitButton>
                </form>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const DEP_KIND: Record<string, [string, string]> = {
  permit: ["Permit", "تصريح"], work_front: ["Work front", "إتاحة موقع العمل"], submittal: ["Submittal", "اعتماد مستند"], material: ["Material", "مواد"],
  weather: ["Weather window", "نافذة الطقس"], cross_service: ["Scaffold access", "السقالات"], client_info: ["Client information", "معلومات من العميل"],
};

export function DependencyList({ items, l, s, back }: { items: Awaited<ReturnType<typeof import("@/lib/projects").listDependencies>>; l: Loc; s: Session; back: string }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((d) => {
        const mine = s.isStaff ? d.owner_side === "rgs" || ["admin", "ops_manager"].includes(s.role) : d.owner_side === "client";
        const overdue = d.status !== "met" && d.status !== "waived" && d.due_date && (daysUntil(d.due_date) ?? 0) < 0;
        return (
          <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Mono>{d.project_ref}</Mono>{d.area_code && <Mono>{d.area_code}</Mono>}
                <Pill tone="neutral">{tx(l, ...(DEP_KIND[d.kind] ?? [d.kind, d.kind]) as [string, string])}</Pill>
                <Pill tone={d.owner_side === "client" ? "brand" : "dark"}>{d.owner_side === "client" ? tx(l, "Client action", "إجراء العميل") : "RGS"}</Pill>
              </div>
              <p className="mt-1 text-sm">{d.description}</p>
              <p className="text-xs text-muted">{d.due_date ? `${tx(l, "Needed by", "مطلوب بتاريخ")} ${fmtDate(d.due_date, l)}` : ""}{d.scaffold_tag ? ` · ${d.scaffold_tag}: ${d.scaffold_status}` : ""}{overdue ? ` · ${tx(l, "overdue", "متأخر")}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={d.status === "met" ? "green" : d.status === "blocked" ? "red" : overdue ? "red" : "yellow"}>{d.status}</Pill>
              {mine && d.status !== "met" && !d.scaffold_tag && (
                <form action={markDependencyAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="status" value="met" />
                  <SubmitButton className="rounded-md bg-ink px-2.5 py-1 text-xs font-semibold text-white">{tx(l, "Mark met", "تم الاستيفاء")}</SubmitButton>
                </form>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function InstructionList({ items, l, staff, back }: { items: Awaited<ReturnType<typeof import("@/lib/projects").listInstructions>>; l: Loc; staff: boolean; back: string }) {
  const tone = (st: string) => (st === "closed" ? "green" : st === "rejected" ? "red" : st === "issued" ? "brand" : "yellow") as "green" | "red" | "brand" | "yellow";
  return (
    <ul className="grid gap-3">
      {items.map((i) => (
        <li key={i.id} className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Mono>{i.ref}</Mono><Mono>{i.project_ref}</Mono><Pill tone={tone(i.status)}>{i.status.replace(/_/g, " ")}</Pill></div>
              <p className="mt-1 font-medium">{i.title}</p>
              {i.description && <p className="text-sm text-muted">{i.description}</p>}
              <p className="mt-1 text-xs text-muted">{tx(l, "Issued by", "صادرة من")} {i.issuer ?? "—"} · {fmtDate(i.issued_at, l)}</p>
              {i.response && <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm"><strong>RGS:</strong> {i.response}</p>}
              {i.vo_ref && <p className="mt-2 text-sm">{i.vo_ref}: <strong className="tabular">{fmtSAR(i.vo_amount, l)}</strong> · <Pill tone={i.vo_status === "approved" ? "green" : i.vo_status === "rejected" ? "red" : "yellow"}>{i.vo_status}</Pill></p>}
            </div>
          </div>
          {staff && i.status === "issued" && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand">Respond or price as a variation</summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <form action={respondInstructionAction} className="grid content-start gap-2">
                  <input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} />
                  <label className="text-xs font-medium" htmlFor={`resp-${i.id}`}>Response to the client</label>
                  <textarea id={`resp-${i.id}`} name="response" rows={3} className={field} placeholder="e.g. Acknowledged, within contract scope; crew mobilises Sunday." />
                  <div className="flex gap-2">
                    <SubmitButton name="status" value="acknowledged" className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white">Acknowledge (no cost)</SubmitButton>
                    <SubmitButton name="status" value="rejected" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold">Decline</SubmitButton>
                  </div>
                </form>
                <form action={submitVariationAction} className="grid content-start gap-2">
                  <input type="hidden" name="instructionId" value={i.id} /><input type="hidden" name="back" value={back} />
                  <input name="title" defaultValue={i.title} aria-label="Variation title" className={field} />
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="grid grid-cols-[1fr_4.5rem_4rem_5rem] gap-1">
                      <input name={`d${k}`} placeholder={k === 0 ? "Description" : ""} aria-label={`Line ${k + 1} description`} className={`${field} py-1`} />
                      <input name={`q${k}`} type="number" step="0.01" placeholder="Qty" aria-label={`Line ${k + 1} quantity`} className={`${field} py-1`} />
                      <select name={`u${k}`} aria-label={`Line ${k + 1} unit`} className={`${field} py-1 text-xs`}>{["m2", "lm", "each", "m3", "lot"].map((u) => <option key={u}>{u}</option>)}</select>
                      <input name={`r${k}`} type="number" step="0.01" placeholder="Rate" aria-label={`Line ${k + 1} rate`} className={`${field} py-1`} />
                    </div>
                  ))}
                  <div className="flex items-center gap-2"><label className="text-xs" htmlFor={`days-${i.id}`}>Time impact (days)</label><input id={`days-${i.id}`} name="days" type="number" min="0" defaultValue={0} className={`${field} w-20 py-1`} /></div>
                  <SubmitButton className="w-fit rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white" pending="Sending…">Send priced variation for approval</SubmitButton>
                </form>
              </div>
            </details>
          )}
        </li>
      ))}
      {!items.length && <li className="py-6 text-center text-sm text-muted">{tx(l, "No instructions yet.", "لا توجد تعليمات بعد.")}</li>}
    </ul>
  );
}

export function NewInstructionForm({ projects, l, back }: { projects: ProjectSummary[]; l: Loc; back: string }) {
  return (
    <form action={raiseInstructionAction} className="grid gap-3 md:grid-cols-[1fr_2fr]">
      <input type="hidden" name="back" value={back} />
      <div className="grid gap-1"><label htmlFor="projectId" className="text-xs font-medium text-muted">{tx(l, "Project", "المشروع")}</label>
        <select id="projectId" name="projectId" className={field}>{projects.map((p) => <option key={p.id} value={p.id}>{p.ref} · {l === "ar" && p.name_ar ? p.name_ar : p.name}</option>)}</select></div>
      <div className="grid gap-1"><label htmlFor="title" className="text-xs font-medium text-muted">{tx(l, "Instruction", "التعليمات")}</label>
        <input id="title" name="title" required minLength={5} className={field} placeholder={tx(l, "e.g. Add waterproofing to the new pump room plinths", "مثال: إضافة عزل مائي لقواعد غرفة المضخات الجديدة")} /></div>
      <div className="grid gap-1 md:col-span-2"><label htmlFor="description" className="text-xs font-medium text-muted">{tx(l, "Details, drawing references, location", "التفاصيل ومراجع المخططات والموقع")}</label>
        <textarea id="description" name="description" rows={2} className={field} /></div>
      <SubmitButton className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" pending="…">{tx(l, "Issue instruction", "إصدار التعليمات")}</SubmitButton>
    </form>
  );
}

const KIND_LABEL: Record<string, [string, string]> = {
  measurement: ["Measurement sheet", "كشف كميات"], variation: ["Variation order", "أمر تغيير"], hold_point: ["Hold point", "نقطة توقف"], completion: ["Completion", "إنجاز"], inspection: ["Inspection", "فحص"], document: ["Document", "مستند"],
};

export function SignoffCard({ so, s, l, back, children }: { so: Signoff; s: Session; l: Loc; back: string; children?: ReactNode }) {
  const mine = awaitingMe(s, so);
  const waiting = so.required_roles.filter((r) => !so.approvals.some((a) => a.role === r));
  return (
    <Card className={mine ? "border-brand/60" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="dark">{tx(l, ...(KIND_LABEL[so.kind] ?? [so.kind, so.kind]) as [string, string])}</Pill>
            {so.project_ref && <Mono>{so.project_ref}</Mono>}
            <Pill tone={so.status === "approved" ? "green" : so.status === "rejected" ? "red" : mine ? "brand" : "yellow"}>{so.status === "pending" ? (mine ? tx(l, "Waiting for you", "بانتظارك") : tx(l, "Pending", "معلق")) : so.status}</Pill>
          </div>
          <p className="mt-2 font-medium">{l === "ar" && so.title_ar ? so.title_ar : so.title}</p>
          {so.summary && <p className="text-sm text-muted">{so.summary}</p>}
          <p className="mt-1 text-xs text-muted">
            {so.amount ? <><strong className="tabular text-ink">{fmtSAR(so.amount, l, 2)}</strong> · </> : null}
            {tx(l, "Signatories", "الموقعون")}: {so.required_roles.map((r) => r.replace("client_", "").replace("admin", "PM")).join(" + ")}
            {so.due_date ? ` · ${tx(l, "due", "مستحق")} ${fmtDate(so.due_date, l)}` : ""}
          </p>
          {so.approvals.length > 0 && <ul className="mt-2 grid gap-0.5 text-xs">{so.approvals.map((a, i) => <li key={i}>{a.decision === "approved" ? "✓" : "✕"} {a.name} ({a.role.replace("client_", "")}) · {fmtDate(a.at, l)}{a.comment ? `: “${a.comment}”` : ""}</li>)}</ul>}
          {so.status === "pending" && waiting.length > 0 && !mine && <p className="mt-1 text-xs text-tag-yellow">{tx(l, "Waiting for", "بانتظار")}: {waiting.map((r) => r.replace("client_", "")).join(", ")}</p>}
          {children}
        </div>
      </div>
      {mine && (
        <form action={decideSignoffAction} className="mt-4 grid gap-2 rounded-lg bg-canvas p-3 md:grid-cols-[1fr_1fr_auto]">
          <input type="hidden" name="id" value={so.id} /><input type="hidden" name="back" value={back} />
          <input name="comment" aria-label="Comment" placeholder={tx(l, "Comment (required to reject)", "ملاحظة (مطلوبة عند الرفض)")} className={field} />
          <input name="signature" aria-label="Signature" required placeholder={tx(l, `Type your full name to sign: ${s.fullName}`, `اكتب اسمك الكامل للتوقيع: ${s.fullName}`)} className={field} />
          <div className="flex gap-2">
            <SubmitButton name="decision" value="rejected" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm font-semibold">{tx(l, "Reject", "رفض")}</SubmitButton>
            <SubmitButton name="decision" value="approved" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{tx(l, "Sign & approve", "توقيع واعتماد")}</SubmitButton>
          </div>
        </form>
      )}
    </Card>
  );
}

export function ActivityList({ items, l }: { items: Activity[]; l: Loc }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{tx(l, "Nothing yet.", "لا شيء بعد.")}</p>;
  let lastDay = "";
  return (
    <ol className="grid gap-1">
      {items.map((a, i) => {
        const dayLabel = fmtDate(a.at, l);
        const head = dayLabel !== lastDay ? ((lastDay = dayLabel), <li key={`d${i}`} className="eyebrow mt-3 first:mt-0">{dayLabel}</li>) : null;
        return [head, (
          <li key={i} className="flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-canvas">
            <span className="mt-0.5 w-20 shrink-0"><Pill tone={a.actor_kind === "agent" ? "dark" : "neutral"}>{a.entity}</Pill></span>
            <span className="min-w-0 flex-1">{a.actor && <strong>{a.actor} </strong>}{a.text}</span>
            {a.link && <Link href={a.link} className="shrink-0 text-xs font-semibold text-brand">→</Link>}
          </li>
        )];
      })}
    </ol>
  );
}

export function MeasureButton({ projectId, back }: { projectId: string; back: string }) {
  return (
    <form action={submitMeasurementAction}>
      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} />
      <SubmitButton className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white" pending="Preparing…">Send measurement sheet to client</SubmitButton>
    </form>
  );
}
