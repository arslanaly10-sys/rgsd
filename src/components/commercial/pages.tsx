import Link from "next/link";
import { getLocale } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import { daysUntil, fmtDate, fmtSAR, type Loc } from "@/lib/format";
import { listProjects } from "@/lib/projects";
import { listWarranties } from "@/lib/quality";
import { claimPreview, listClaims, listCreditNotes, retentionPosition, statementOfAccount } from "@/lib/commercial";
import { CATEGORIES, getTicket, listContacts, listTickets, SLA_HOURS } from "@/lib/support";
import { CERT_KINDS, competencyMatrix, workforceSummary } from "@/lib/workforce";
import { siteSummaries } from "@/lib/queries";
import {
  assignCrewAction, bookRefreshersAction, closeTicketAction, createCreditNoteAction, createTicketAction, recordPaymentAction, releaseRetentionAction,
  replyTicketAction, submitClaimAction, submitCreditNoteAction, uploadCertificateAction, verifyCertificateAction,
} from "@/lib/actions/commercial";
import { SubmitButton } from "../submit-button";
import { ButtonLink, Card, Flash, Kpi, Mono, PageHeader, Pill, statusTone, Table, Td } from "../ui";
import { tx } from "../delivery/views";

type P = { s: Session; base: "/ops" | "/client"; msg?: string };
const loc = async () => (await getLocale()) as Loc;
const field = "rounded-lg border border-line bg-panel px-3 py-2 text-sm";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white";
const btnDark = "rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white";
const FIN = ["admin", "finance", "ops_manager"];

const CLAIM_STATUS: Record<string, [string, string]> = {
  draft: ["Draft", "مسودة"], submitted: ["Waiting for client certification", "بانتظار اعتماد العميل"], certified: ["Certified", "معتمد"], rejected: ["Returned", "مُعاد"], invoiced: ["Invoiced", "تمت الفوترة"],
};
const claimTone = (st: string) => (st === "invoiced" || st === "certified" ? "green" : st === "submitted" ? "brand" : st === "rejected" ? "red" : "neutral") as "green";

// ───────────────────────── Progress claims ─────────────────────────
export async function ClaimsPage({ s, base, msg }: P) {
  const l = await loc();
  const [projects, claims] = await Promise.all([listProjects(s), listClaims(s)]);
  const canAct = s.isStaff && FIN.includes(s.role);
  const extra = await Promise.all(projects.map(async (p) => ({
    id: p.id,
    preview: s.isStaff ? await withUser(s, (db) => claimPreview(db, p.id)) : null,
    retention: await retentionPosition(s, p.id),
  })));
  const by = Object.fromEntries(extra.map((e) => [e.id, e]));
  const pending = claims.filter((c) => c.status === "submitted").length;
  const held = extra.reduce((t, e) => t + e.retention.outstanding, 0);
  return (
    <>
      <PageHeader title={tx(l, "Progress claims", "المستخلصات")}
        sub={tx(l, "Monthly interim payment claims (cut-off on the 25th): certified measurements and approved variations, less 10% retention and advance recovery. The client certifies each claim; RGS then issues the tax invoice.", "مستخلصات شهرية (الإقفال يوم 25): الكميات المعتمدة والأوامر التغييرية ناقصاً 10% محتجزات واسترداد الدفعة المقدمة. يعتمد العميل كل مستخلص ثم تصدر RGS الفاتورة الضريبية.")}
        actions={<ButtonLink href={`${base}/statement`} variant="ghost">{tx(l, "Statement of account", "كشف الحساب")}</ButtonLink>} />
      <Flash msg={msg} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Claims to date", "المستخلصات حتى الآن")} value={claims.length} />
        <Kpi label={tx(l, "Waiting for certification", "بانتظار الاعتماد")} value={pending} tone={pending ? "brand" : "default"} href={s.isStaff ? undefined : `${base}/signoffs`} />
        <Kpi label={tx(l, "Retention held", "المحتجزات")} value={fmtSAR(held, l)} />
        <Kpi label={tx(l, "Certified (net) to date", "صافي المعتمد")} value={fmtSAR(claims.filter((c) => ["certified", "invoiced"].includes(c.status)).reduce((t, c) => t + Number(c.net), 0), l)} />
      </div>
      <div className="grid gap-4">
        {projects.map((p) => {
          const e = by[p.id];
          const mine = claims.filter((c) => c.project_id === p.id);
          const r = e.retention;
          return (
            <Card key={p.id} title={`${p.ref} · ${l === "ar" && p.name_ar ? p.name_ar : p.name}`} action={<span className="text-xs text-muted">{l === "ar" && p.client_ar ? p.client_ar : p.client}{p.po_number ? ` · PO ${p.po_number}` : ""}</span>}>
              {e.preview && (
                <div className="mb-3 rounded-lg border border-dashed border-line p-3 text-sm">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{tx(l, "Next claim if submitted today", "المستخلص التالي إذا قُدّم اليوم")}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular md:grid-cols-3">
                    <span>{tx(l, "Gross to date", "الإجمالي التراكمي")}: <strong>{fmtSAR(e.preview.gross_cumulative, l)}</strong></span>
                    <span>{tx(l, "Previously claimed", "المطالب سابقاً")}: {fmtSAR(e.preview.previous_gross, l)}</span>
                    <span>{tx(l, "This claim", "هذا المستخلص")}: <strong>{fmtSAR(e.preview.this_gross, l)}</strong></span>
                    <span>{tx(l, "Retention", "المحتجزات")} {e.preview.retention_pct}%: −{fmtSAR(e.preview.retention, l)}</span>
                    <span>{tx(l, "Advance recovery", "استرداد الدفعة المقدمة")}: −{fmtSAR(e.preview.advance_recovery, l)}</span>
                    <span>{tx(l, "Net + VAT", "الصافي + الضريبة")}: <strong>{fmtSAR(e.preview.total, l, 2)}</strong></span>
                  </div>
                  {canAct && (
                    <form action={submitClaimAction} className="mt-2">
                      <input type="hidden" name="projectId" value={p.id} />
                      <SubmitButton className={btnDark} pending="…" disabled={e.preview.this_gross <= 0}>{tx(l, "Submit claim to client", "إرسال المستخلص للعميل")}</SubmitButton>
                      {e.preview.this_gross <= 0 && <span className="ms-2 text-xs text-muted">{tx(l, "Nothing new since the last claim: get the latest measurement signed.", "لا جديد منذ آخر مستخلص.")}</span>}
                    </form>
                  )}
                </div>
              )}
              <Table head={[tx(l, "Claim", "المستخلص"), tx(l, "Period to", "حتى"), tx(l, "This claim", "هذا المستخلص"), tx(l, "Retention", "المحتجزات"), tx(l, "Advance rec.", "استرداد المقدمة"), tx(l, "Net + VAT", "الصافي + الضريبة"), tx(l, "Status", "الحالة"), tx(l, "Invoice", "الفاتورة")]}
                empty={mine.length ? undefined : tx(l, "No claims yet.", "لا توجد مستخلصات بعد.")} minWidth={820}>
                {mine.map((c) => (
                  <tr key={c.id}>
                    <Td><Mono>{c.ref}</Mono><div className="text-xs text-muted">No. {c.seq}</div></Td>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(c.period_to, l)}</Td>
                    <Td className="tabular">{fmtSAR(c.this_gross, l)}</Td>
                    <Td className="tabular">−{fmtSAR(c.retention, l)}</Td>
                    <Td className="tabular">−{fmtSAR(c.advance_recovery, l)}</Td>
                    <Td className="tabular font-medium">{fmtSAR(c.total, l, 2)}</Td>
                    <Td><Pill tone={claimTone(c.status)}>{tx(l, ...CLAIM_STATUS[c.status])}</Pill></Td>
                    <Td>{c.invoice_ref ? <Link className="font-semibold text-brand" href={`/inv/${c.invoice_id}`}><Mono>{c.invoice_ref}</Mono></Link> : "—"}</Td>
                  </tr>
                ))}
              </Table>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <span>{tx(l, "Retention held", "المحتجزات")}: <strong className="tabular">{fmtSAR(r.held, l)}</strong></span>
                <span>{tx(l, "Released", "المفرج عنه")}: <span className="tabular">{fmtSAR(r.released, l)}</span></span>
                <span className="text-muted">{r.completed ? tx(l, `50% at completion; the rest after the defects liability period (${r.dlp_end ?? "—"}).`, `50% عند الإنجاز والباقي بعد فترة الضمان (${r.dlp_end ?? "—"}).`) : tx(l, "Released 50% at completion and 50% after the defects liability period.", "يفرج عن 50% عند الإنجاز و50% بعد فترة الضمان.")}</span>
                {canAct && (r.first_half_due || r.second_half_due) && (
                  <form action={releaseRetentionAction}><input type="hidden" name="projectId" value={p.id} /><SubmitButton className={btnDark} pending="…">{tx(l, "Draft retention release invoice", "إعداد فاتورة الإفراج")}</SubmitButton></form>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ───────────────────────── Credit & debit notes (staff) ─────────────────────────
export async function CreditNotesPage({ s, msg }: P) {
  const l = await loc();
  const [list, invoices] = await Promise.all([
    listCreditNotes(s),
    withUser(s, (db) => rows<{ ref: string; client: string; total: string }>(db, "select i.ref, c.name client, i.total from invoices i join client_companies c on c.id = i.client_company_id where i.status in ('issued','paid') order by i.ref desc")),
  ]);
  const canAct = FIN.includes(s.role);
  return (
    <>
      <PageHeader title={tx(l, "Credit & debit notes", "الإشعارات الدائنة والمدينة")} sub={tx(l, "Adjust an issued tax invoice (ZATCA): credit notes reduce what the client owes, debit notes add to it. Every note needs Finance approval and carries its own QR.", "تعديل فاتورة ضريبية صادرة: الإشعار الدائن يخفض المستحق والمدين يزيده. كل إشعار يحتاج موافقة المالية ويحمل رمز QR.")} />
      <Flash msg={msg} />
      {canAct && (
        <Card title={tx(l, "Draft a note", "إعداد إشعار")} className="mb-4">
          <form action={createCreditNoteAction} className="grid gap-2 md:grid-cols-6">
            <select name="invoiceRef" aria-label="Invoice" className={`${field} md:col-span-2`}>{invoices.map((i) => <option key={i.ref} value={i.ref}>{i.ref} · {i.client} · {fmtSAR(i.total, l)}</option>)}</select>
            <select name="kind" aria-label="Type" className={field}><option value="credit">Credit note</option><option value="debit">Debit note</option></select>
            <input name="amount" type="number" step="0.01" min="0.01" required aria-label="Amount before VAT" placeholder="Amount before VAT" className={field} />
            <input name="reason" required minLength={10} aria-label="Reason" placeholder="Reason (the client sees this)" className={`${field} md:col-span-2`} />
            <SubmitButton className={btn} pending="…">Draft</SubmitButton>
          </form>
        </Card>
      )}
      <Card>
        <Table head={["Note", "Invoice", "Client", "Reason", "Total", "Status", ""]} empty={list.length ? undefined : "No notes yet."} minWidth={820}>
          {list.map((n) => (
            <tr key={n.id}>
              <Td><Mono>{n.ref}</Mono><div className="text-xs text-muted">{n.kind}</div></Td>
              <Td><Mono>{n.invoice_ref}</Mono></Td>
              <Td>{n.client}</Td>
              <Td className="max-w-80 text-muted">{n.reason}</Td>
              <Td className="tabular font-medium">{n.kind === "credit" ? "−" : "+"}{fmtSAR(n.total, l, 2)}</Td>
              <Td><Pill tone={n.status === "issued" ? "green" : n.status === "pending_approval" ? "yellow" : "brand"}>{n.status.replace("_", " ")}</Pill>{n.issued_at && <div className="text-xs text-muted">{fmtDate(n.issued_at, l)}</div>}</Td>
              <Td>{canAct && n.status === "draft" && <form action={submitCreditNoteAction}><input type="hidden" name="ref" value={n.ref} /><SubmitButton className={btnDark} pending="…">Submit for approval</SubmitButton></form>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

// ───────────────────────── Statement of account & ageing ─────────────────────────
const BUCKETS: [keyof Awaited<ReturnType<typeof statementOfAccount>>["buckets"], string, string][] = [["current", "Not yet due", "غير مستحق"], ["d30", "1–30 days", "1–30 يوم"], ["d60", "31–60 days", "31–60 يوم"], ["d90", "61–90 days", "61–90 يوم"], ["over90", "Over 90 days", "أكثر من 90 يوم"]];

export async function StatementPage({ s, base, msg, client }: P & { client?: string }) {
  const l = await loc();
  const companies = s.isStaff ? await withUser(s, (db) => rows<{ id: string; name: string }>(db, "select id, name from client_companies order by name")) : [];
  const clientId = s.isStaff ? companies.find((c) => c.id === client)?.id : s.clientCompanyId ?? undefined;
  const st = await statementOfAccount(s, clientId);
  const canPay = s.isStaff && ["admin", "finance"].includes(s.role);
  return (
    <>
      <PageHeader title={tx(l, "Statement of account", "كشف الحساب")} sub={tx(l, "Every issued invoice, credit/debit note and payment with a running balance, and what is outstanding by age.", "كل الفواتير والإشعارات والمدفوعات مع الرصيد الجاري، والمستحقات حسب العمر.")}
        actions={s.isStaff ? (
          <form className="flex gap-2"><select name="client" defaultValue={clientId ?? ""} aria-label="Client" className={`${field} py-1.5`}><option value="">All clients</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className={btnDark}>Show</button></form>
        ) : undefined} />
      <Flash msg={msg} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label={tx(l, "Total outstanding", "إجمالي المستحق")} value={fmtSAR(st.total_outstanding, l)} tone="brand" />
        {BUCKETS.map(([k, en, ar]) => <Kpi key={k} label={tx(l, en, ar)} value={fmtSAR(st.buckets[k], l)} tone={k !== "current" && st.buckets[k] > 0 ? (k === "d30" ? "yellow" : "red") : "default"} />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Card title={tx(l, "Open invoices", "الفواتير المفتوحة")}>
          <Table head={[tx(l, "Invoice", "الفاتورة"), ...(s.isStaff ? ["Client"] : []), tx(l, "Due", "الاستحقاق"), tx(l, "Outstanding", "المستحق"), ""]} empty={st.open.length ? undefined : tx(l, "Nothing outstanding.", "لا مستحقات.")} minWidth={480}>
            {st.open.map((o) => (
              <tr key={o.ref}>
                <Td><Mono>{o.ref}</Mono></Td>
                {s.isStaff && <Td className="text-xs">{o.client}</Td>}
                <Td className="whitespace-nowrap text-muted">{fmtDate(o.due_date, l)}</Td>
                <Td className="tabular font-medium">{fmtSAR(o.outstanding, l, 2)}</Td>
                <Td>{o.days > 0 ? <Pill tone={o.days > 30 ? "red" : "yellow"}>{tx(l, `${o.days} d overdue`, `متأخرة ${o.days} يوم`)}</Pill> : <Pill>{tx(l, "current", "غير مستحقة")}</Pill>}</Td>
              </tr>
            ))}
          </Table>
          {canPay && st.open.length > 0 && (
            <form action={recordPaymentAction} className="mt-3 grid gap-2 border-t border-line pt-3 md:grid-cols-5">
              <select name="invoiceRef" aria-label="Invoice" className={`${field} md:col-span-2`}>{st.open.map((o) => <option key={o.ref} value={o.ref}>{o.ref} · {fmtSAR(o.outstanding, l, 2)}</option>)}</select>
              <input name="amount" type="number" step="0.01" min="0.01" required aria-label="Amount received" placeholder="Amount received" className={field} />
              <input name="reference" aria-label="Bank reference" placeholder="Bank reference" className={field} />
              <SubmitButton className={btn} pending="…">Record payment</SubmitButton>
            </form>
          )}
        </Card>
        <Card title={tx(l, "Ledger", "السجل")}>
          <Table head={[tx(l, "Date", "التاريخ"), tx(l, "Reference", "المرجع"), tx(l, "Description", "الوصف"), tx(l, "Debit", "مدين"), tx(l, "Credit", "دائن"), tx(l, "Balance", "الرصيد")]} empty={st.lines.length ? undefined : "—"} minWidth={680}>
            {st.lines.map((x, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap text-muted">{fmtDate(x.date, l)}</Td>
                <Td><Mono>{x.ref}</Mono></Td>
                <Td className="text-xs">{x.description}{s.isStaff && !clientId ? <span className="text-muted"> · {x.client}</span> : null}</Td>
                <Td className="tabular">{x.debit ? fmtSAR(x.debit, l, 2) : ""}</Td>
                <Td className="tabular text-tag-green">{x.credit ? fmtSAR(x.credit, l, 2) : ""}</Td>
                <Td className="tabular font-medium">{fmtSAR(x.balance, l, 2)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

// ───────────────────────── Support ─────────────────────────
const CAT: Record<string, [string, string]> = { defect: ["Defect", "عيب"], warranty_claim: ["Warranty claim", "مطالبة ضمان"], billing: ["Billing", "فواتير"], safety: ["Safety", "سلامة"], portal: ["Portal", "البوابة"], general: ["General", "عام"] };
const TSTATUS: Record<string, [string, string]> = { open: ["Open", "مفتوحة"], in_progress: ["In progress", "قيد المعالجة"], waiting_client: ["Waiting for you", "بانتظارك"], resolved: ["Resolved", "تم الحل"], closed: ["Closed", "مغلقة"] };
const ticketTone = (st: string) => (st === "closed" || st === "resolved" ? "green" : st === "waiting_client" ? "yellow" : "brand") as "green";

function SlaLabel({ t, l }: { t: { respond_by: string; resolve_by: string; first_response_at: string | null; status: string; escalated_at: string | null }; l: Loc }) {
  if (["resolved", "closed"].includes(t.status)) return null;
  const late = (!t.first_response_at && new Date(t.respond_by) < new Date()) || new Date(t.resolve_by) < new Date();
  const target = t.first_response_at ? t.resolve_by : t.respond_by;
  return <span className={`text-xs ${late ? "font-semibold text-tag-red" : "text-muted"}`}>{late ? tx(l, "SLA missed", "تجاوز مستوى الخدمة") : `${t.first_response_at ? tx(l, "Resolve by", "الحل قبل") : tx(l, "Reply by", "الرد قبل")} ${new Date(target).toLocaleString(l === "ar" ? "ar-SA" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })}`}{t.escalated_at ? ` · ${tx(l, "escalated", "مصعّدة")}` : ""}</span>;
}

export async function SupportPage({ s, base, msg }: P) {
  const l = await loc();
  const [tickets, projects, warranties, companies] = await Promise.all([
    listTickets(s), listProjects(s), listWarranties(s),
    s.isStaff ? withUser(s, (db) => rows<{ id: string; name: string }>(db, "select id, name from client_companies order by name")) : Promise.resolve([]),
  ]);
  const active = warranties.filter((w) => w.status === "active");
  const open = tickets.filter((t) => !["resolved", "closed"].includes(t.status));
  return (
    <>
      <PageHeader title={tx(l, "Support", "الدعم")} sub={tx(l, "Tickets with response and resolution targets. Warranty claims book an RGS inspection within 24 hours.", "تذاكر بأهداف للرد والحل. مطالبات الضمان تحجز فحصاً من RGS خلال 24 ساعة.")}
        actions={!s.isStaff ? <ButtonLink href="/client/help" variant="ghost">{tx(l, "Help centre", "مركز المساعدة")}</ButtonLink> : undefined} />
      <Flash msg={msg} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Open", "مفتوحة")} value={open.length} tone={open.length ? "brand" : "default"} />
        <Kpi label={tx(l, "Waiting for client", "بانتظار العميل")} value={tickets.filter((t) => t.status === "waiting_client").length} />
        <Kpi label={tx(l, "SLA missed", "تجاوز مستوى الخدمة")} value={open.filter((t) => (!t.first_response_at && new Date(t.respond_by) < new Date()) || new Date(t.resolve_by) < new Date()).length} tone="red" />
        <Kpi label={tx(l, "Avg. satisfaction", "متوسط الرضا")} value={(() => { const r = tickets.filter((t) => t.satisfaction); return r.length ? `${(r.reduce((a, t) => a + (t.satisfaction ?? 0), 0) / r.length).toFixed(1)}/5` : "—"; })()} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title={tx(l, "Tickets", "التذاكر")}>
          <Table head={[tx(l, "Ticket", "التذكرة"), tx(l, "Subject", "الموضوع"), tx(l, "Priority", "الأولوية"), tx(l, "Status", "الحالة"), tx(l, "Target", "الهدف")]} empty={tickets.length ? undefined : tx(l, "No tickets.", "لا توجد تذاكر.")} minWidth={700}>
            {tickets.map((t) => (
              <tr key={t.id}>
                <Td><Link href={`${base}/support/${t.id}`} className="font-semibold text-brand"><Mono>{t.ref}</Mono></Link><div className="text-xs text-muted">{tx(l, ...CAT[t.category])}</div></Td>
                <Td><div className="font-medium">{t.subject}</div><div className="text-xs text-muted">{[t.project_ref, t.warranty_ref, s.isStaff ? t.client : null].filter(Boolean).join(" · ")}</div></Td>
                <Td><Pill tone={statusTone(t.priority)}>{t.priority}</Pill></Td>
                <Td><Pill tone={ticketTone(t.status)}>{tx(l, ...TSTATUS[t.status])}</Pill></Td>
                <Td><SlaLabel t={t} l={l} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={tx(l, "Open a ticket", "فتح تذكرة")}>
          <form action={createTicketAction} className="grid gap-2">
            {s.isStaff && <select name="clientCompanyId" aria-label="Client" className={field}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            <div className="grid grid-cols-2 gap-2">
              <select name="category" aria-label={tx(l, "Category", "الفئة")} className={field}>{CATEGORIES.map((c) => <option key={c} value={c}>{tx(l, ...CAT[c])}</option>)}</select>
              <select name="priority" aria-label={tx(l, "Priority", "الأولوية")} defaultValue="normal" className={field}>{Object.entries(SLA_HOURS).map(([k, v]) => <option key={k} value={k}>{k} · {tx(l, `reply ${v.respond} h`, `رد ${v.respond} س`)}</option>)}</select>
            </div>
            <select name="projectId" aria-label={tx(l, "Project", "المشروع")} className={field}><option value="">{tx(l, "No specific project", "بدون مشروع محدد")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.ref} · {p.name}</option>)}</select>
            <select name="warrantyId" aria-label={tx(l, "Warranty (for warranty claims)", "الضمان (لمطالبات الضمان)")} className={field}><option value="">{tx(l, "Warranty (claims only)", "الضمان (للمطالبات فقط)")}</option>{active.map((w) => <option key={w.id} value={w.id}>{w.ref} · {w.system}</option>)}</select>
            <input name="subject" required minLength={5} maxLength={200} aria-label={tx(l, "Subject", "الموضوع")} placeholder={tx(l, "Subject", "الموضوع")} className={field} />
            <textarea name="body" required minLength={10} rows={4} aria-label={tx(l, "Describe the issue", "صف المشكلة")} placeholder={tx(l, "What happened, where, since when?", "ماذا حدث وأين ومنذ متى؟")} className={field} />
            <SubmitButton className={btn} pending="…">{tx(l, "Open ticket", "فتح التذكرة")}</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

export async function TicketPage({ s, base, msg, id }: P & { id: string }) {
  const l = await loc();
  const t = await getTicket(s, id);
  if (!t) return <PageHeader title={tx(l, "Ticket not found", "التذكرة غير موجودة")} />;
  const open = !["closed"].includes(t.status);
  return (
    <>
      <PageHeader title={`${t.ref} · ${t.subject}`} sub={[tx(l, ...CAT[t.category]), t.project_ref, t.warranty_ref, s.isStaff ? t.client : null].filter(Boolean).join(" · ")}
        actions={<ButtonLink href={`${base}/support`} variant="ghost">{tx(l, "All tickets", "كل التذاكر")}</ButtonLink>} />
      <Flash msg={msg} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill tone={ticketTone(t.status)}>{tx(l, ...TSTATUS[t.status])}</Pill><Pill tone={statusTone(t.priority)}>{t.priority}</Pill><SlaLabel t={t} l={l} />
        {t.assignee_name && <span className="text-xs text-muted">{tx(l, "Handled by", "المسؤول")}: {t.assignee_name}</span>}
        {t.satisfaction && <span className="text-xs text-muted">{tx(l, "Rated", "التقييم")} {t.satisfaction}/5</span>}
      </div>
      <div className="grid gap-3">
        {t.messages.map((m) => (
          <div key={m.id} className={`rounded-xl border p-3 ${m.internal ? "border-dashed border-tag-yellow bg-tag-yellow-bg" : m.staff ? "border-line bg-panel" : "border-brand-50 bg-brand-50/40"}`}>
            <div className="mb-1 text-xs text-muted"><strong className="text-ink">{m.author ?? "—"}</strong> · {m.staff ? "RGS" : tx(l, "Client", "العميل")}{m.internal ? ` · ${tx(l, "internal note", "ملاحظة داخلية")}` : ""} · {new Date(m.created_at).toLocaleString(l === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" })}</div>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </div>
        ))}
      </div>
      {open && (
        <Card className="mt-4" title={tx(l, "Reply", "رد")}>
          <form action={replyTicketAction} className="grid gap-2">
            <input type="hidden" name="id" value={t.id} />
            <textarea name="body" required rows={3} aria-label={tx(l, "Reply", "رد")} className={field} />
            <div className="flex flex-wrap items-center gap-3">
              {s.isStaff && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="internal" value="1" /> Internal note (client can't see)</label>}
              {s.isStaff && <select name="status" aria-label="Set status" defaultValue="" className={`${field} py-1.5`}><option value="">Keep status</option><option value="in_progress">In progress</option><option value="waiting_client">Waiting for client</option><option value="resolved">Resolved</option></select>}
              <SubmitButton className={btn} pending="…">{tx(l, "Send", "إرسال")}</SubmitButton>
            </div>
          </form>
        </Card>
      )}
      {(t.status === "resolved" || (s.isStaff && open)) && (
        <Card className="mt-4" title={s.isStaff ? "Close ticket" : tx(l, "Is it fixed? Close and rate", "هل تم الحل؟ أغلق وقيّم")}>
          <form action={closeTicketAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={t.id} />
            {!s.isStaff && <select name="satisfaction" aria-label={tx(l, "Rating", "التقييم")} defaultValue="5" className={`${field} py-1.5`}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n}/5</option>)}</select>}
            <SubmitButton className={btnDark} pending="…">{tx(l, "Close ticket", "إغلاق التذكرة")}</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}

// ───────────────────────── Contacts & help ─────────────────────────
export async function ContactsPage({ s }: P) {
  const l = await loc();
  const list = await listContacts(s);
  const groups = Object.entries(Object.groupBy(list, (c) => `${c.project_ref} · ${c.project_name}`));
  return (
    <>
      <PageHeader title={tx(l, "Contact directory", "دليل جهات الاتصال")} sub={tx(l, "Who to call on each project, on the RGS side and yours, including the 24/7 emergency line.", "بمن تتصل في كل مشروع من جانب RGS وجانبكم، بما في ذلك خط الطوارئ على مدار الساعة.")} />
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map(([g, cs]) => (
          <Card key={g} title={g}>
            <ul className="divide-y divide-line">
              {cs!.map((c, i) => (
                <li key={i} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{l === "ar" && c.role_label_ar ? c.role_label_ar : c.role_label}{c.hours ? ` · ${c.hours}` : ""}</div></div>
                  <div className="text-end text-sm">
                    <Pill tone={c.side === "rgs" ? "brand" : "neutral"}>{c.side === "rgs" ? "RGS" : tx(l, "Client", "العميل")}</Pill>
                    {c.phone && <div><a href={`tel:${c.phone.replace(/\s/g, "")}`} className="tabular text-brand" dir="ltr">{c.phone}</a></div>}
                    {c.email && <div className="text-xs"><a href={`mailto:${c.email}`} className="text-muted">{c.email}</a></div>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}

export async function HelpPage({ s }: P) {
  const l = await loc();
  const faq = await withUser(s, (db) => rows<{ heading: string; content: string }>(db,
    "select k.heading, k.content from kb_chunks k join kb_documents d on d.id = k.kb_document_id where d.kind = 'faq' and d.language = $1 order by k.chunk_index", [l]));
  return (
    <>
      <PageHeader title={tx(l, "Help centre", "مركز المساعدة")} sub={tx(l, "Answers to common questions. Or ask the assistant (bottom corner): it can read your projects, sign-offs, claims and statement, and open a ticket for you.", "إجابات للأسئلة الشائعة. أو اسأل المساعد (أسفل الشاشة): يمكنه قراءة مشاريعك وتوقيعاتك ومستخلصاتك وكشف حسابك وفتح تذكرة لك.")}
        actions={<ButtonLink href="/client/support">{tx(l, "Open a ticket", "فتح تذكرة")}</ButtonLink>} />
      <div className="mb-4 rounded-xl border border-line bg-panel p-4 text-sm">
        <div className="mb-2 font-semibold">{tx(l, "Try asking the assistant", "جرّب أن تسأل المساعد")}</div>
        <ul className="grid gap-1 text-muted md:grid-cols-2">
          {(l === "ar" ? ["ما الذي ينتظر توقيعي؟", "ما رصيد كشف حسابنا؟", "ما حالة المستخلصات؟", "افتح تذكرة: تسرب في سقف المستودع"] : ["What's waiting for my signature?", "What's our statement balance and ageing?", "What's the status of our claims?", "Open a ticket: water leak on the warehouse roof"]).map((q) => <li key={q}>“{q}”</li>)}
        </ul>
      </div>
      <div className="grid gap-2">
        {faq.map((f, i) => (
          <details key={i} className="rounded-xl border border-line bg-panel p-4">
            <summary className="cursor-pointer font-medium">{f.heading}</summary>
            <p className="mt-2 text-sm text-muted">{f.content}</p>
          </details>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── Workforce (staff) ─────────────────────────
const CERT_SHORT: Record<string, string> = { cisrs: "CISRS", citb: "CITB", tuv_scaffold: "TÜV", aramco_scaffold_card: "Aramco scaf.", aramco_id: "Aramco ID", opito_bosiet: "BOSIET", h2s: "H2S", working_at_height: "WAH", first_aid: "First aid", rigging: "Rigging", driving_licence: "Licence" };
const CELL: Record<string, string> = { valid: "bg-tag-green-bg text-tag-green", expiring: "bg-tag-yellow-bg text-tag-yellow", expired: "bg-tag-red-bg text-tag-red", missing: "text-line" };

export async function WorkforcePage({ s, msg }: P) {
  const l = await loc();
  const [matrix, sum, sites, unverified, trainings] = await Promise.all([
    competencyMatrix(s), workforceSummary(s), siteSummaries(s),
    withUser(s, (db) => rows<{ id: string; kind: string; expires_on: string; employee_no: string; full_name: string; issuer: string | null }>(db,
      "select c.id, c.kind, c.expires_on::text, w.employee_no, w.full_name, c.issuer from certifications c join workers w on w.id = c.worker_id where not c.verified order by (c.ai_extracted is not null) desc, c.expires_on limit 20")),
    withUser(s, (db) => rows<{ title: string; scheduled_on: string; capacity: number; booked: number }>(db,
      "select t.title, t.scheduled_on::text, t.capacity, (select count(*) from training_attendees a where a.session_id = t.id)::int booked from training_sessions t where t.scheduled_on >= current_date order by t.scheduled_on limit 8")),
  ]);
  const blocked = matrix.filter((w) => w.status === "active" && w.site_code && !w.check.ok);
  const canAssign = ["admin", "ops_manager", "site_supervisor"].includes(s.role);
  const canCerts = ["admin", "ops_manager", "hse_training", "site_supervisor"].includes(s.role);
  const saudiPct = sum.active ? Math.round((sum.saudi / sum.active) * 100) : 0;
  const shown = CERT_KINDS.filter((k) => matrix.some((w) => w.cells[k].required || w.cells[k].state !== "missing"));
  return (
    <>
      <PageHeader title={tx(l, "Workforce & competency", "القوى العاملة والكفاءة")} sub={tx(l, "Competency matrix against each site's rules (offshore: BOSIET, H2S, Aramco ID; Aramco plants: scaffold card), crew assignment with automatic checks, certificate reading and refresher booking.", "مصفوفة الكفاءة حسب متطلبات كل موقع، وتعيين الطواقم مع فحص تلقائي، وقراءة الشهادات وحجز الدورات التنشيطية.")} />
      <Flash msg={msg} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={tx(l, "Active workers", "العمال النشطون")} value={sum.active} hint={tx(l, `${sum.on_leave} on leave`, `${sum.on_leave} في إجازة`)} />
        <Kpi label={tx(l, "Saudization", "نسبة السعودة")} value={`${saudiPct}%`} hint={tx(l, `${sum.saudi} Saudi nationals (Nitaqat)`, `${sum.saudi} سعوديون (نطاقات)`)} />
        <Kpi label={tx(l, "Not cleared for their site", "غير مؤهلين لموقعهم")} value={blocked.length} tone={blocked.length ? "red" : "default"} />
        <Kpi label={tx(l, "Booked on training", "محجوزون في التدريب")} value={sum.trainings} />
      </div>
      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        {canAssign && (
          <Card title={tx(l, "Assign crew", "تعيين طاقم")}>
            <form action={assignCrewAction} className="grid gap-2">
              <select name="siteCode" aria-label="Site" className={field}>{sites.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}</select>
              <input name="employeeNos" required aria-label="Employee numbers" placeholder="RGS-1031, RGS-2008" className={field} />
              <select name="startInDays" aria-label="Start" defaultValue="1" className={field}>{[0, 1, 2, 3, 7].map((d) => <option key={d} value={d}>{d === 0 ? "Start today" : `Start in ${d} day(s)`}</option>)}</select>
              <SubmitButton className={btn} pending="…">Check & assign</SubmitButton>
              <p className="text-xs text-muted">Workers missing a required certificate for the site are refused and listed.</p>
            </form>
          </Card>
        )}
        {canCerts && (
          <Card title={tx(l, "Read a certificate", "قراءة شهادة")}>
            <form action={uploadCertificateAction} className="grid gap-2">
              <input type="file" name="file" required accept="image/jpeg,image/png,image/webp,application/pdf" aria-label="Certificate photo or PDF" className="text-sm" />
              <input name="employeeNo" aria-label="Employee number" placeholder="Employee no. (if not on the card)" className={field} />
              <SubmitButton className={btn} pending="Reading…">Read & record</SubmitButton>
              <p className="text-xs text-muted">AI reads the type, number and expiry. It is recorded unverified until HSE checks the original.</p>
            </form>
          </Card>
        )}
        <Card title={tx(l, "Upcoming refreshers", "الدورات التنشيطية القادمة")} action={["admin", "ops_manager", "hse_training"].includes(s.role) ? <form action={bookRefreshersAction}><SubmitButton className={btnDark} pending="…">Book expiring</SubmitButton></form> : undefined}>
          <ul className="divide-y divide-line text-sm">
            {trainings.map((t, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span>{t.title}</span><span className="whitespace-nowrap text-muted tabular">{fmtDate(t.scheduled_on, l)} · {t.booked}/{t.capacity}</span></li>)}
            {!trainings.length && <li className="py-2 text-muted">No sessions scheduled.</li>}
          </ul>
        </Card>
      </div>
      {unverified.length > 0 && (
        <Card title={tx(l, "Certificates waiting for verification", "شهادات بانتظار التحقق")} className="mb-4">
          <Table head={["Worker", "Certificate", "Expires", "Source", ""]} minWidth={600}>
            {unverified.map((c) => (
              <tr key={c.id}>
                <Td><Mono>{c.employee_no}</Mono> {c.full_name}</Td>
                <Td>{c.kind.replace(/_/g, " ")}</Td>
                <Td className="text-muted">{fmtDate(c.expires_on, l)}</Td>
                <Td className="text-xs text-muted">{c.issuer ?? "—"}</Td>
                <Td>{["admin", "hse_training"].includes(s.role) && <form action={verifyCertificateAction}><input type="hidden" name="id" value={c.id} /><SubmitButton className={btnDark} pending="…">Verify original</SubmitButton></form>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card title={tx(l, "Competency matrix", "مصفوفة الكفاءة")} action={<span className="flex gap-2 text-[11px]"><span className={`rounded px-1 ${CELL.valid}`}>valid</span><span className={`rounded px-1 ${CELL.expiring}`}>≤30 d</span><span className={`rounded px-1 ${CELL.expired}`}>expired / missing (required)</span></span>}>
        <Table head={["Worker", "Site", ...shown.map((k) => CERT_SHORT[k]), "Iqama", "Status"]} minWidth={1100}>
          {matrix.map((w) => (
            <tr key={w.id} className={w.status !== "active" ? "opacity-50" : ""}>
              <Td><div className="whitespace-nowrap font-medium">{w.full_name}</div><div className="text-xs text-muted"><Mono>{w.employee_no}</Mono> · {w.trade.replace(/_/g, " ")}</div></Td>
              <Td><Mono>{w.site_code ?? "—"}</Mono></Td>
              {shown.map((k) => {
                const c = w.cells[k];
                const cls = c.state === "missing" ? (c.required ? CELL.expired : CELL.missing) : CELL[c.state];
                return <Td key={k} className="px-1 text-center"><span title={c.expires_on ?? (c.required ? "required, missing" : "")} className={`inline-block min-w-12 rounded px-1 py-0.5 text-[11px] tabular ${cls} ${c.required ? "font-semibold ring-1 ring-current/30" : ""}`}>{c.state === "missing" ? (c.required ? "✕" : "·") : c.expires_on?.slice(2, 7)}{c.state !== "missing" && !c.verified ? "*" : ""}</span></Td>;
              })}
              <Td className="whitespace-nowrap text-xs">{w.iqama_expiry ? <span className={(daysUntil(w.iqama_expiry) ?? 99) < 30 ? "font-semibold text-tag-red" : "text-muted"}>{fmtDate(w.iqama_expiry, l)}</span> : "—"}</Td>
              <Td>{w.check.ok ? (w.check.warnings.length ? <Pill tone="yellow">{w.check.warnings.length} warning</Pill> : <Pill tone="green">cleared</Pill>) : <span title={w.check.blockers.join(", ")}><Pill tone="red">blocked: {w.check.blockers.join(", ").slice(0, 40)}</Pill></span>}</Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">* recorded from an uploaded card, not yet verified against the original. Cells show expiry (YY-MM).</p>
      </Card>
    </>
  );
}
