import Link from "next/link";
import { getLocale } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import { daysUntil, fmtDate, fmtNum, type Loc } from "@/lib/format";
import { listAreas, listProjects } from "@/lib/projects";
import { handoverReadiness, hseKpis, listDocuments, listEvidence, listFindings, listItp, listWarranties, REVIEWERS, type Finding } from "@/lib/quality";
import { findingStepAction, raiseFindingAction, recordItpAction, requestCompletionAction, reviewDocumentAction, submitRevisionAction, uploadEvidenceAction } from "@/lib/actions/quality";
import { SubmitButton } from "../submit-button";
import { ButtonLink, Card, Flash, Kpi, Mono, PageHeader, Pill, Table, Td } from "../ui";
import { ServiceChip, tx } from "../delivery/views";

type P = { s: Session; base: "/ops" | "/client"; msg?: string };
const loc = async () => (await getLocale()) as Loc;
const field = "rounded-lg border border-line bg-panel px-3 py-2 text-sm";
const STEP_TONE: Record<string, "green" | "red" | "yellow" | "neutral" | "brand"> = { passed: "green", failed: "red", awaiting_client: "brand", pending: "neutral", waived: "neutral" };
const KIND_TONE: Record<string, "dark" | "brand" | "yellow" | "neutral"> = { hold: "brand", witness: "yellow", test: "dark", inspection: "neutral" };

// ───────────────────────── Inspections (ITP) ─────────────────────────
export async function InspectionsPage({ s, base, msg }: P) {
  const l = await loc();
  const steps = await listItp(s);
  const canRecord = s.isStaff && ["admin", "ops_manager", "inspector", "site_supervisor", "hse_training"].includes(s.role);
  const groups = Object.entries(Object.groupBy(steps, (x) => `${x.project_ref} · ${x.area_code} · ${x.area_name}`));
  const count = (st: string) => steps.filter((x) => x.status === st).length;
  return (
    <>
      <PageHeader title={tx(l, "Inspections & tests", "الفحوصات والاختبارات")} sub={tx(l, "Inspection & test plans per area: tests pass or fail against the acceptance criteria; hold and witness points need the client before work continues. Scaffold tags are on the scaffold register.", "خطط الفحص والاختبار لكل منطقة: تنجح الاختبارات أو تفشل حسب معايير القبول؛ نقاط التوقف والشهود تحتاج العميل قبل متابعة العمل.")}
        actions={<ButtonLink href={`${base}/scaffolds`} variant="ghost">{tx(l, "Scaffold tags", "بطاقات السقالات")}</ButtonLink>} />
      <Flash msg={msg} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Passed", "ناجحة")} value={count("passed")} />
        <Kpi label={tx(l, "Waiting for client witness", "بانتظار حضور العميل")} value={count("awaiting_client")} tone={count("awaiting_client") ? "brand" : "default"} href={`${base}/signoffs`} />
        <Kpi label={tx(l, "Failed (NCR raised)", "فاشلة (تقرير عدم مطابقة)")} value={count("failed")} tone={count("failed") ? "red" : "default"} href={`${base}/findings`} />
        <Kpi label={tx(l, "To do", "متبقية")} value={count("pending")} />
      </div>
      <div className="grid gap-4">
        {groups.map(([g, list]) => (
          <Card key={g} title={g} action={<ServiceChip line={list![0].service_line} l={l} />}>
            <ol className="grid gap-2">
              {list!.map((st) => (
                <li key={st.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="tabular text-xs text-muted">#{st.seq}</span><Pill tone={KIND_TONE[st.kind]}>{st.kind}</Pill><span className="font-medium">{l === "ar" && st.title_ar ? st.title_ar : st.title}</span></div>
                      <p className="text-xs text-muted">{st.criteria}</p>
                      {st.readings.length > 0 && <p className="mt-1 text-sm tabular">{tx(l, "Readings", "القراءات")}: {st.readings.map((r) => `${r.value}${st.acceptance?.unit ? ` ${st.acceptance.unit}` : ""}`).join(" · ")}{st.inspector ? <span className="text-xs text-muted"> · {st.inspector}, {fmtDate(st.inspected_at, l)}</span> : null}</p>}
                      {st.result_note && <p className="text-xs text-muted">{st.result_note}</p>}
                    </div>
                    <Pill tone={STEP_TONE[st.status]}>{st.status === "awaiting_client" ? tx(l, "Waiting for client", "بانتظار العميل") : st.status}</Pill>
                  </div>
                  {canRecord && ["pending", "failed"].includes(st.status) && (
                    <form action={recordItpAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="stepId" value={st.id} /><input type="hidden" name="back" value={`${base}/inspections`} />
                      {st.acceptance ? (
                        <input name="readings" aria-label={`Readings for ${st.title}`} placeholder={st.acceptance.equals ? `e.g. ${st.acceptance.equals}` : `Readings${st.acceptance.unit ? ` (${st.acceptance.unit})` : ""}, comma-separated`} className={`${field} min-w-0 flex-1 py-1.5`} />
                      ) : (
                        <select name="visual" aria-label={`Result for ${st.title}`} className={`${field} py-1.5`}><option value="pass">Acceptable</option><option value="fail">Not acceptable</option></select>
                      )}
                      <input name="note" aria-label="Note" placeholder="Note / location" className={`${field} min-w-0 flex-1 py-1.5`} />
                      <SubmitButton className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white" pending="…">Record</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── Findings & corrective actions ─────────────────────────
const SEV_TONE = { critical: "red", high: "red", medium: "yellow", low: "neutral" } as const;
const FSTATUS: Record<string, [string, string]> = { open: ["Open", "مفتوحة"], action_planned: ["Action planned", "تم تخطيط الإجراء"], verification: ["Awaiting close-out", "بانتظار الإغلاق"], closed: ["Closed", "مغلقة"], rejected: ["Rejected", "مرفوضة"] };
const FKIND: Record<string, [string, string]> = { ncr: ["NCR", "عدم مطابقة"], observation: ["Observation", "ملاحظة"], punch: ["Punch item", "ملاحظة تسليم"], hse: ["HSE", "سلامة"], audit: ["Audit", "تدقيق"] };

function FindingHead({ f, l }: { f: Finding; l: Loc }) {
  const overdue = !["closed", "rejected"].includes(f.status) && f.due_date && (daysUntil(f.due_date) ?? 0) < 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Mono>{f.ref}</Mono>{f.project_ref && <Mono>{f.project_ref}</Mono>}{f.area_code && <Mono>{f.area_code}</Mono>}
        <Pill tone="dark">{tx(l, ...FKIND[f.kind])}</Pill><Pill tone={SEV_TONE[f.severity as "low"]}>{f.severity}</Pill>
        <Pill tone={f.status === "closed" ? "green" : f.status === "verification" ? "brand" : overdue ? "red" : "yellow"}>{tx(l, ...FSTATUS[f.status])}{overdue ? ` · ${tx(l, "overdue", "متأخرة")}` : ""}</Pill>
      </div>
      <p className="mt-1 font-medium">{f.title}</p>
      {f.description && <p className="whitespace-pre-wrap text-sm text-muted">{f.description}</p>}
      <p className="mt-1 text-xs text-muted">{f.raised_side === "client" ? tx(l, "Raised by client", "من العميل") : "RGS"}{f.raised_by_name ? ` · ${f.raised_by_name}` : ""} · {fmtDate(f.created_at, l)}{f.due_date ? ` · ${tx(l, "due", "مستحقة")} ${fmtDate(f.due_date, l)}` : ""}</p>
    </>
  );
}

export async function FindingsPage({ s, base, msg }: P) {
  const l = await loc();
  const [list, projects, areas] = await Promise.all([listFindings(s), listProjects(s), listAreas(s)]);
  return (
    <>
      <PageHeader title={tx(l, "Findings", "الملاحظات")} sub={tx(l, "Non-conformances, client observations, HSE findings and punch-list items across all projects.", "حالات عدم المطابقة وملاحظات العميل وملاحظات السلامة وقوائم التسليم لجميع المشاريع.")} />
      <Flash msg={msg} />
      <Card title={s.isStaff ? "Raise a finding" : tx(l, "Report an observation", "الإبلاغ عن ملاحظة")} className="mb-4">
        <form action={raiseFindingAction} className="grid gap-2 md:grid-cols-4">
          <input type="hidden" name="back" value={`${base}/findings`} />
          <select name="projectId" aria-label="Project" className={field}>{projects.map((p) => <option key={p.id} value={p.id}>{p.ref}</option>)}</select>
          <select name="areaId" aria-label="Area" className={field}><option value="">{tx(l, "Whole project", "المشروع كاملاً")}</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.project_ref} · {a.code}</option>)}</select>
          {s.isStaff ? <select name="kind" aria-label="Type" className={field}>{["ncr", "hse", "punch", "audit", "observation"].map((k) => <option key={k} value={k}>{FKIND[k][0]}</option>)}</select> : <input type="hidden" name="kind" value="observation" />}
          <select name="severity" aria-label="Severity" defaultValue="medium" className={field}>{["low", "medium", "high", "critical"].map((k) => <option key={k} value={k}>{k}</option>)}</select>
          <input name="title" required minLength={5} aria-label="Title" placeholder={tx(l, "What did you see, where?", "ماذا لاحظت وأين؟")} className={`${field} md:col-span-2`} />
          <input name="description" aria-label="Details" placeholder={tx(l, "Details (optional)", "تفاصيل (اختياري)")} className={`${field} md:col-span-${s.isStaff ? 1 : 2}`} />
          <SubmitButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" pending="…">{tx(l, "Submit", "إرسال")}</SubmitButton>
        </form>
      </Card>
      <div className="grid gap-3">{list.map((f) => <Card key={f.id}><FindingHead f={f} l={l} />{f.corrective_action && <p className="mt-2 text-sm"><strong>{tx(l, "Corrective action", "الإجراء التصحيحي")}:</strong> {f.corrective_action}</p>}<Link href={`${base}/corrective#${f.ref}`} className="mt-2 inline-block text-xs font-semibold text-brand">{tx(l, "Corrective action", "الإجراء التصحيحي")} →</Link></Card>)}</div>
    </>
  );
}

export async function CorrectivePage({ s, base, msg }: P) {
  const l = await loc();
  const list = (await listFindings(s)).filter((f) => f.kind !== "observation" || f.status !== "open" || s.isStaff);
  const clientCan = !s.isStaff && ["client_admin", "client_consultant", "client_hse"].includes(s.role);
  return (
    <>
      <PageHeader title={tx(l, "Corrective actions", "الإجراءات التصحيحية")} sub={tx(l, "Root cause, correction, corrective and preventive action, then verification. NCRs and client observations are closed by the client.", "السبب الجذري والتصحيح والإجراء التصحيحي والوقائي ثم التحقق. يغلق العميل حالات عدم المطابقة وملاحظاته.")} />
      <Flash msg={msg} />
      <div className="grid gap-3">
        {list.map((f) => {
          const clientCloses = f.raised_side === "client" || f.kind === "ncr";
          return (
            <Card key={f.id} className={!s.isStaff && f.status === "verification" ? "border-brand/60" : ""}>
              <div id={f.ref} className="scroll-mt-20"><FindingHead f={f} l={l} /></div>
              {(f.root_cause || f.corrective_action) && (
                <dl className="mt-3 grid gap-2 rounded-lg bg-canvas p-3 text-sm md:grid-cols-2">
                  {([["Root cause", "السبب الجذري", f.root_cause], ["Correction", "التصحيح الفوري", f.correction], ["Corrective action", "الإجراء التصحيحي", f.corrective_action], ["Preventive action", "الإجراء الوقائي", f.preventive_action]] as const).map(([en, ar, v]) => v ? <div key={en}><dt className="text-xs text-muted">{tx(l, en, ar)}</dt><dd>{v}</dd></div> : null)}
                  <div className="text-xs text-muted md:col-span-2">{f.owner_name ? `${tx(l, "Owner", "المسؤول")}: ${f.owner_name}` : ""}{f.action_due ? ` · ${tx(l, "action due", "الموعد")} ${fmtDate(f.action_due, l)}` : ""}{f.closed_at ? ` · ${tx(l, "closed by", "أغلقها")} ${f.closed_by_name} ${fmtDate(f.closed_at, l)}` : ""}</div>
                </dl>
              )}
              {s.isStaff && ["open", "action_planned"].includes(f.status) && (
                <details className="mt-3" open={f.status === "open"}>
                  <summary className="cursor-pointer text-sm font-semibold text-brand">{f.status === "open" ? "Plan the corrective action" : "Edit plan"}</summary>
                  <form action={findingStepAction} className="mt-2 grid gap-2 md:grid-cols-2">
                    <input type="hidden" name="id" value={f.id} /><input type="hidden" name="back" value={`${base}/corrective`} /><input type="hidden" name="step" value="plan" />
                    <textarea name="root_cause" aria-label="Root cause" required defaultValue={f.root_cause ?? ""} placeholder="Root cause (why did it happen?)" rows={2} className={field} />
                    <textarea name="correction" aria-label="Correction" defaultValue={f.correction ?? ""} placeholder="Correction (immediate fix)" rows={2} className={field} />
                    <textarea name="corrective_action" aria-label="Corrective action" required defaultValue={f.corrective_action ?? ""} placeholder="Corrective action (stop it recurring here)" rows={2} className={field} />
                    <textarea name="preventive_action" aria-label="Preventive action" defaultValue={f.preventive_action ?? ""} placeholder="Preventive action (other sites and crews)" rows={2} className={field} />
                    <div className="flex items-center gap-2"><label className="text-xs" htmlFor={`due-${f.id}`}>Action due</label><input id={`due-${f.id}`} name="action_due" type="date" defaultValue={f.action_due ?? f.due_date ?? ""} className={field} /></div>
                    <SubmitButton className="w-fit rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white" pending="…">Save plan</SubmitButton>
                  </form>
                </details>
              )}
              {s.isStaff && f.status === "action_planned" && (
                <form action={findingStepAction} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={f.id} /><input type="hidden" name="back" value={`${base}/corrective`} /><input type="hidden" name="step" value="verify" />
                  <input name="note" aria-label="What was done" placeholder="What was done (evidence, re-test result)" className={`${field} min-w-0 flex-1`} />
                  <SubmitButton className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">{clientCloses ? "Done: send to client to close" : "Done: verify"}</SubmitButton>
                </form>
              )}
              {f.status === "verification" && ((clientCan && clientCloses) || (s.isStaff && (!clientCloses || s.role === "admin"))) && (
                <form action={findingStepAction} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={f.id} /><input type="hidden" name="back" value={`${base}/corrective`} />
                  <input name="note" aria-label="Comment" placeholder={tx(l, "Comment (required to send back)", "ملاحظة (مطلوبة عند الإرجاع)")} className={`${field} min-w-0 flex-1`} />
                  <SubmitButton name="step" value="reopen" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">{tx(l, "Send back", "إرجاع")}</SubmitButton>
                  <SubmitButton name="step" value="close" className="rounded-lg bg-tag-green px-3 py-2 text-sm font-semibold text-white">{tx(l, "Close", "إغلاق")}</SubmitButton>
                </form>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ───────────────────────── Checklist templates ─────────────────────────
export async function ChecklistsPage({ s }: P) {
  const l = await loc();
  const list = await withUser(s, (db) => rows<{ id: string; code: string; name: string; name_ar: string | null; service_line: string; version: number; items: { seq: number; title: string; title_ar: string; kind: string; criteria: string; acceptance?: { min?: number; max?: number; unit?: string; equals?: string } }[]; client: string | null }>(db,
    "select t.id, t.code, t.name, t.name_ar, t.service_line, t.version, t.items, c.name client from checklist_templates t left join client_companies c on c.id = t.client_company_id where t.active order by t.service_line, t.code"));
  const acc = (a?: { min?: number; max?: number; unit?: string; equals?: string }) => !a ? "" : a.equals ? `= ${a.equals}` : `${a.min != null ? `≥ ${a.min}` : ""}${a.max != null ? ` ≤ ${a.max}` : ""} ${a.unit ?? ""}`;
  return (
    <>
      <PageHeader title={tx(l, "Checklist templates", "قوالب قوائم الفحص")} sub={tx(l, "Versioned inspection & test plans per service line. Client-specific variants override the RGS standard for that client. SAMPLE criteria.", "خطط فحص واختبار مرقمة الإصدار لكل خط خدمة. النسخ الخاصة بالعميل تحل محل معيار RGS. معايير تجريبية.")} />
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((t) => (
          <Card key={t.id} title={`${t.code} v${t.version}`} action={<span className="flex gap-1"><ServiceChip line={t.service_line} l={l} />{t.client && <Pill tone="brand">{t.client}</Pill>}</span>}>
            <p className="mb-2 font-medium">{l === "ar" && t.name_ar ? t.name_ar : t.name}</p>
            <Table minWidth={420} head={["#", tx(l, "Step", "الخطوة"), tx(l, "Type", "النوع"), tx(l, "Acceptance", "القبول")]}>
              {t.items.map((it) => <tr key={it.seq}><Td className="tabular text-muted">{it.seq}</Td><Td><div>{l === "ar" ? it.title_ar : it.title}</div><div className="text-xs text-muted">{it.criteria}</div></Td><Td><Pill tone={KIND_TONE[it.kind]}>{it.kind}</Pill></Td><Td className="whitespace-nowrap text-xs tabular">{acc(it.acceptance)}</Td></tr>)}
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── HSE ─────────────────────────
export async function HsePage({ s }: P) {
  const l = await loc();
  const [k, talks, permits, chems, waste] = await Promise.all([
    hseKpis(s),
    withUser(s, (db) => rows<{ held_on: string; topic: string; topic_ar: string | null; language: string; attendees: number; ref: string }>(db, "select t.held_on::text, t.topic, t.topic_ar, t.language, t.attendees, p.ref from toolbox_talks t left join projects p on p.id = t.project_id order by t.held_on desc limit 12")),
    withUser(s, (db) => rows<{ ref: string; kind: string; issued_by: string | null; valid_from: string; valid_to: string; status: string; jsa: { step: string; hazard: string; control: string }[]; project: string | null; area: string | null }>(db, "select pm.ref, pm.kind, pm.issued_by, pm.valid_from, pm.valid_to, pm.status, pm.jsa, p.ref project, a.code area from permits pm left join projects p on p.id = pm.project_id left join project_areas a on a.id = pm.area_id order by pm.valid_to desc")),
    withUser(s, (db) => rows<{ product: string; product_ar: string | null; service_line: string; hazard_class: string | null; ghs: string[]; storage: string | null; ppe: string | null; msds_revised: string | null }>(db, "select product, product_ar, service_line, hazard_class, ghs, storage, ppe, msds_revised::text from chemical_register order by service_line, product")),
    withUser(s, (db) => rows<{ kind: string; qty: string; unit: string; disposal: string; manifest_ref: string | null; ref: string | null; logged_on: string }>(db, "select w.kind, w.qty, w.unit, w.disposal, w.manifest_ref, p.ref, w.logged_on::text from waste_log w left join projects p on p.id = w.project_id order by w.logged_on desc")),
  ]);
  return (
    <>
      <PageHeader title="HSE" sub={tx(l, "Safety performance, permits and job safety analyses, toolbox talks, the chemical register (MSDS) and waste. TRIR per 200,000 hours, LTIFR per 1,000,000 hours.", "أداء السلامة والتصاريح وتحليل مخاطر العمل واجتماعات السلامة وسجل المواد الكيميائية والنفايات.")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Man-hours (3 months)", "ساعات العمل (3 أشهر)")} value={fmtNum(k.hours, l)} hint={`${k.headcount} ${tx(l, "on site this month", "في الموقع هذا الشهر")}`} />
        <Kpi label="LTI · LTIFR" value={`${k.lti} · ${fmtNum(k.ltifr, l, 2)}`} hint={k.last_lti ? `${tx(l, "last LTI", "آخر إصابة")} ${fmtDate(k.last_lti, l)}` : tx(l, "No lost-time injuries", "لا إصابات مضيعة للوقت")} tone={k.lti ? "red" : "default"} />
        <Kpi label="TRIR" value={fmtNum(k.trir, l, 2)} hint={`${k.first_aid} ${tx(l, "first aid", "إسعافات أولية")} · ${k.near_miss} ${tx(l, "near misses", "حوادث وشيكة")} · ${k.observations} ${tx(l, "observations", "ملاحظات")}`} />
        <Kpi label={tx(l, "Toolbox talks (30 days)", "اجتماعات السلامة (30 يوماً)")} value={k.talks} hint={`${k.attendance} ${tx(l, "attendances", "حضور")} · ${k.permits} ${tx(l, "active permits", "تصاريح سارية")} · ${k.open_hse} ${tx(l, "open HSE findings", "ملاحظات سلامة مفتوحة")}`} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title={tx(l, "Permits & JSAs", "التصاريح وتحليل المخاطر")}>
          <ul className="grid gap-3">
            {permits.map((pm) => (
              <li key={pm.ref} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2"><Mono>{pm.ref}</Mono><Pill tone="dark">{pm.kind.replace(/_/g, " ")}</Pill>{pm.project && <Mono>{pm.project}</Mono>}{pm.area && <Mono>{pm.area}</Mono>}<Pill tone={pm.status === "active" && new Date(pm.valid_to) > new Date() ? "green" : "neutral"}>{new Date(pm.valid_to) > new Date() ? pm.status : "expired"}</Pill></div>
                <p className="text-xs text-muted">{pm.issued_by} · {fmtDate(pm.valid_from, l)} {new Date(pm.valid_from).toISOString().slice(11, 16)}–{new Date(pm.valid_to).toISOString().slice(11, 16)} UTC</p>
                <ul className="mt-1 grid gap-0.5 text-sm">{pm.jsa.map((j, i) => <li key={i}>• <strong>{j.step}</strong>: {j.hazard} → <span className="text-muted">{j.control}</span></li>)}</ul>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={tx(l, "Toolbox talks", "اجتماعات السلامة")}>
          <ul className="divide-y divide-line text-sm">{talks.map((t, i) => <li key={i} className="flex justify-between gap-3 py-2"><span><Mono>{t.ref}</Mono> {l === "ar" && t.topic_ar ? t.topic_ar : t.topic}</span><span className="shrink-0 text-xs text-muted">{fmtDate(t.held_on, l)} · {t.attendees} · {t.language.toUpperCase()}</span></li>)}</ul>
        </Card>
        <Card title={tx(l, "Chemical register (MSDS)", "سجل المواد الكيميائية")}>
          <Table minWidth={520} head={[tx(l, "Product", "المنتج"), tx(l, "Hazard", "الخطر"), tx(l, "Storage / PPE", "التخزين / معدات الوقاية")]}>
            {chems.map((c) => <tr key={c.product}><Td><div>{l === "ar" && c.product_ar ? c.product_ar : c.product}</div><ServiceChip line={c.service_line} l={l} /></Td><Td className="text-xs">{c.hazard_class}{c.ghs.length ? <div className="text-muted">{c.ghs.join(", ")}</div> : null}</Td><Td className="text-xs text-muted">{c.storage}<div>{c.ppe}</div></Td></tr>)}
          </Table>
        </Card>
        <Card title={tx(l, "Waste", "النفايات")}>
          <ul className="divide-y divide-line text-sm">{waste.map((w, i) => <li key={i} className="flex justify-between gap-3 py-2"><span><Mono>{w.ref ?? "—"}</Mono> {w.kind.replace(/_/g, " ")}<span className="block text-xs text-muted">{w.disposal}{w.manifest_ref ? ` · ${w.manifest_ref}` : ""}</span></span><span className="shrink-0 tabular">{fmtNum(w.qty, l)} {w.unit}</span></li>)}</ul>
        </Card>
      </div>
    </>
  );
}

// ───────────────────────── Documents & reviews ─────────────────────────
const DSTATUS: Record<string, ["green" | "yellow" | "red" | "brand" | "neutral", string, string]> = {
  approved: ["green", "A · Approved", "أ · معتمد"], approved_with_comments: ["green", "B · Approved with comments", "ب · معتمد مع ملاحظات"], revise_resubmit: ["yellow", "C · Revise & resubmit", "ج · يعدل ويعاد"],
  rejected: ["red", "D · Rejected", "د · مرفوض"], under_review: ["brand", "Under review", "قيد المراجعة"], draft: ["neutral", "Draft", "مسودة"], superseded: ["neutral", "Superseded", "ملغى"],
};

export async function DocumentsPage({ s, base, msg }: P) {
  const l = await loc();
  const docs = await listDocuments(s);
  const canSubmit = s.isStaff && ["admin", "ops_manager", "estimator", "hse_training", "site_supervisor"].includes(s.role);
  return (
    <>
      <PageHeader title={tx(l, "Documents", "المستندات")} sub={tx(l, "Controlled document register: method statements, material submittals, shop drawings, ITPs, test reports and handover documents, with every revision and its review code.", "سجل المستندات المضبوطة مع كل إصدار ورمز مراجعته.")} />
      <Flash msg={msg} />
      <div className="grid gap-3">
        {docs.map((d) => {
          const last = d.revs.at(-1);
          const prevComments = last?.comments ?? [];
          const [tone, en, ar] = DSTATUS[d.status];
          return (
            <Card key={d.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Mono>{d.number}</Mono><span className="text-xs text-muted">rev {d.current_rev}</span><Mono>{d.project_ref}</Mono><Pill tone="neutral">{d.doc_type.replace(/_/g, " ")}</Pill>{d.required_for_handover && <Pill tone="dark">{tx(l, "handover", "تسليم")}</Pill>}</div>
                  <p className="mt-1 font-medium">{l === "ar" && d.title_ar ? d.title_ar : d.title}</p>
                </div>
                <Pill tone={tone}>{tx(l, en, ar)}</Pill>
              </div>
              <ol className="mt-2 grid gap-1 text-xs">
                {d.revs.filter((r) => r.submitted_at || s.isStaff).map((r) => (
                  <li key={r.id} className="rounded-md bg-canvas px-2 py-1.5">
                    <span className="font-semibold">rev {r.rev}</span> · {r.submitted_at ? `${r.transmittal_ref ?? ""} ${tx(l, "submitted", "مقدم")} ${fmtDate(r.submitted_at, l)}` : tx(l, "draft (not submitted)", "مسودة")}
                    {r.review_code ? ` · ${tx(l, "code", "رمز")} ${r.review_code} ${r.reviewer ? `(${r.reviewer})` : ""} ${fmtDate(r.reviewed_at, l)}` : r.submitted_at ? ` · ${tx(l, "review due", "موعد المراجعة")} ${fmtDate(r.due_date, l)}` : ""}
                    {r.document_id && <> · <a href={`/api/files/${r.document_id}`} target="_blank" rel="noreferrer" className="font-semibold text-brand">{tx(l, "file", "الملف")}</a></>}
                    {r.comments.length > 0 && <ul className="mt-1 grid gap-0.5 ps-3">{r.comments.map((c) => <li key={c.no}>{c.no}. {c.comment}{c.response ? <span className="text-tag-green"> → RGS: {c.response}</span> : null}</li>)}</ul>}
                  </li>
                ))}
              </ol>
              {canSubmit && ["draft", "revise_resubmit", "rejected", "approved_with_comments"].includes(d.status) && !(d.status === "approved_with_comments" && !d.required_for_handover) && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand">{d.status === "draft" ? "Submit for review" : "Respond to comments and resubmit"}</summary>
                  <form action={submitRevisionAction} className="mt-2 grid gap-2">
                    <input type="hidden" name="documentId" value={d.id} /><input type="hidden" name="back" value={`${base}/documents`} />
                    {d.status !== "draft" && prevComments.map((c, i) => <input key={c.no} name={`response_${i}`} defaultValue={c.response ?? ""} aria-label={`Response to comment ${c.no}`} placeholder={`Response to comment ${c.no}: ${c.comment.slice(0, 60)}`} className={field} />)}
                    <input type="file" name="file" accept=".pdf,image/*,.txt" aria-label="Revision file" className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold" />
                    <SubmitButton className="w-fit rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white" pending="…">Submit</SubmitButton>
                  </form>
                </details>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

export async function DocReviewPage({ s, base, msg }: P) {
  const l = await loc();
  const docs = await listDocuments(s, { pendingReview: true });
  const canReview = !s.isStaff && REVIEWERS.includes(s.role);
  return (
    <>
      <PageHeader title={tx(l, "Document reviews", "مراجعة المستندات")} sub={tx(l, "Submittals waiting for a review code. A: approved · B: approved with comments · C: revise and resubmit · D: rejected. Approving a submittal clears any dependency waiting on it.", "المستندات بانتظار رمز المراجعة. أ: معتمد · ب: معتمد مع ملاحظات · ج: يعدل ويعاد · د: مرفوض.")} />
      <Flash msg={msg} />
      {!docs.length && <Card><p className="py-6 text-center text-sm text-muted">{tx(l, "Nothing waiting for review.", "لا يوجد ما ينتظر المراجعة.")}</p></Card>}
      <div className="grid gap-3">
        {docs.map((d) => {
          const r = d.revs.filter((x) => x.submitted_at).at(-1)!;
          const overdue = r?.due_date && (daysUntil(r.due_date) ?? 0) < 0;
          return (
            <Card key={d.id} className={canReview ? "border-brand/60" : ""}>
              <div className="flex flex-wrap items-center gap-2"><Mono>{d.number}</Mono><span className="text-xs text-muted">rev {r.rev}</span><Mono>{d.project_ref}</Mono><Pill tone={overdue ? "red" : "brand"}>{tx(l, "due", "مستحق")} {fmtDate(r.due_date, l)}{overdue ? ` · ${tx(l, "overdue", "متأخر")}` : ""}</Pill></div>
              <p className="mt-1 font-medium">{l === "ar" && d.title_ar ? d.title_ar : d.title}</p>
              {d.revs.length > 1 && <p className="text-xs text-muted">{tx(l, "Previous", "السابق")}: rev {d.revs.at(-2)!.rev} {tx(l, "code", "رمز")} {d.revs.at(-2)!.review_code} · {d.revs.at(-2)!.comments.filter((c) => c.response).length}/{d.revs.at(-2)!.comments.length} {tx(l, "comments answered", "ملاحظات تمت الإجابة عنها")}</p>}
              {r.document_id && <a href={`/api/files/${r.document_id}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand">{tx(l, "Open file", "فتح الملف")} →</a>}
              {canReview && (
                <form action={reviewDocumentAction} className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                  <input type="hidden" name="revId" value={r.id} /><input type="hidden" name="back" value={`${base}/docreview`} />
                  <textarea name="comments" rows={2} aria-label="Comments" placeholder={tx(l, "Comments, one per line (required for B, C, D)", "الملاحظات، كل ملاحظة في سطر (مطلوبة لـ ب، ج، د)")} className={field} />
                  <div className="flex flex-wrap items-start gap-1">{(["A", "B", "C", "D"] as const).map((c) => <SubmitButton key={c} name="code" value={c} className={`rounded-lg px-3 py-2 text-sm font-bold ${c === "A" || c === "B" ? "bg-tag-green text-white" : c === "C" ? "bg-tag-yellow-bg text-tag-yellow" : "bg-tag-red-bg text-tag-red"}`}>{c}</SubmitButton>)}</div>
                </form>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

export async function EvidencePage({ s, base, msg }: P) {
  const l = await loc();
  const [items, areas] = await Promise.all([listEvidence(s), s.isStaff ? listAreas(s) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title={tx(l, "Photos & evidence", "الصور والأدلة")} sub={tx(l, "Site photos and files from inspections, tests, areas and document submissions.", "صور الموقع والملفات من الفحوصات والاختبارات والمناطق والمستندات.")} />
      <Flash msg={msg} />
      {s.isStaff && (
        <Card title="Add evidence to an area" className="mb-4">
          <form action={uploadEvidenceAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="back" value={`${base}/evidence`} />
            <select name="areaId" aria-label="Area" className={field}>{areas.map((a) => <option key={a.id} value={a.id}>{a.project_ref} · {a.code} {a.name}</option>)}</select>
            <input name="caption" aria-label="Caption" placeholder="Caption (what, where, which stage)" className={`${field} min-w-0 flex-1`} />
            <input type="file" name="file" accept="image/*,.pdf" capture="environment" aria-label="File" className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold" />
            <SubmitButton className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white" pending="Uploading…">Upload</SubmitButton>
          </form>
        </Card>
      )}
      {!items.length ? <Card><p className="py-6 text-center text-sm text-muted">{tx(l, "No evidence yet.", "لا توجد أدلة بعد.")}</p></Card> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((d) => (
            <a key={d.id} href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-line bg-panel">
              {d.mime?.startsWith("image/") ? (/* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/files/${d.id}`} alt={d.title} className="aspect-[4/3] w-full object-cover" />) : <div className="flex aspect-[4/3] items-center justify-center bg-canvas text-xs text-muted">{d.mime?.split("/")[1]?.toUpperCase()}</div>}
              <div className="p-2 text-xs"><div className="truncate font-medium">{d.title}</div><div className="truncate text-muted">{d.project_ref ? `${d.project_ref} · ` : ""}{d.context} · {fmtDate(d.created_at, l)}</div></div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

// ───────────────────────── Handover & warranty ─────────────────────────
export async function HandoverPage({ s, base, msg }: P) {
  const l = await loc();
  const [projects, warranties] = await Promise.all([listProjects(s), listWarranties(s)]);
  const ready = await Promise.all(projects.map((p) => handoverReadiness(s, p.id)));
  return (
    <>
      <PageHeader title={tx(l, "Handover", "التسليم")} sub={tx(l, "Readiness per project (areas, ITP, findings, punch list, documents, warranties), the completion sign-off, and the warranty register. Warranties start on the date the client signs completion.", "جاهزية كل مشروع للتسليم وشهادة الإنجاز وسجل الضمانات. تبدأ الضمانات من تاريخ توقيع العميل على الإنجاز.")} />
      <Flash msg={msg} />
      <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((p, i) => {
          const h = ready[i];
          return (
            <Card key={p.id} title={`${p.ref} · ${h.score}% ${tx(l, "ready", "جاهز")}`} action={<Pill tone={p.status === "completed" ? "green" : h.ready ? "green" : "yellow"}>{p.status === "completed" ? tx(l, "Completed", "مكتمل") : h.ready ? tx(l, "Ready", "جاهز") : tx(l, "Not ready", "غير جاهز")}</Pill>}>
              <p className="mb-2 text-sm">{l === "ar" && p.name_ar ? p.name_ar : p.name}</p>
              <ul className="grid gap-1 text-sm">{h.checks.map((c) => <li key={c.key} className={c.ok ? "" : "text-muted"}>{c.ok ? "✓" : "○"} {tx(l, c.en, c.ar)}</li>)}</ul>
              {s.isStaff && ["admin", "ops_manager"].includes(s.role) && p.status !== "completed" && !h.completion_pending && (
                <form action={requestCompletionAction} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="back" value={`${base}/handover`} />
                  {!h.ready && <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="override" value="1" className="accent-brand" /> Request with open items (listed to the client)</label>}
                  <SubmitButton className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Request completion sign-off</SubmitButton>
                </form>
              )}
              {h.completion_pending > 0 && <p className="mt-2 text-sm text-brand">{tx(l, "Completion sign-off waiting for the client.", "شهادة الإنجاز بانتظار توقيع العميل.")} <Link href={`${base}/signoffs`} className="font-semibold">→</Link></p>}
            </Card>
          );
        })}
      </div>
      <div className="mt-4"><Card title={tx(l, "Warranty register", "سجل الضمانات")}>
        <Table minWidth={800} head={[tx(l, "Ref", "المرجع"), tx(l, "Project / area", "المشروع / المنطقة"), tx(l, "System & coverage", "النظام والتغطية"), tx(l, "Type", "النوع"), tx(l, "Term", "المدة"), tx(l, "Status", "الحالة"), ""]}>
          {warranties.map((w) => (
            <tr key={w.id}>
              <Td><Mono>{w.ref}</Mono></Td>
              <Td><Mono>{w.project_ref}</Mono>{w.area_code && <> <Mono>{w.area_code}</Mono></>}</Td>
              <Td className="max-w-[280px]"><div>{w.system}</div><div className="text-xs text-muted">{l === "ar" && w.coverage_ar ? w.coverage_ar : w.coverage}</div></Td>
              <Td className="text-xs">{w.kind === "joint_manufacturer" ? tx(l, "RGS + manufacturer", "RGS + المصنع") : "RGS"}</Td>
              <Td className="whitespace-nowrap text-xs">{w.years} {tx(l, "years", "سنوات")}{w.starts_on ? <div className="text-muted">{fmtDate(w.starts_on, l)} – {fmtDate(w.ends_on, l)}</div> : <div className="text-muted">{tx(l, "starts at completion", "يبدأ عند الإنجاز")}</div>}</Td>
              <Td><Pill tone={w.status === "active" ? "green" : "neutral"}>{w.status}</Pill></Td>
              <Td>{w.status === "active" && <ButtonLink href={`/warranty/${w.id}`} variant="ghost">{tx(l, "Certificate", "الشهادة")}</ButtonLink>}</Td>
            </tr>
          ))}
        </Table>
      </Card></div>
    </>
  );
}
