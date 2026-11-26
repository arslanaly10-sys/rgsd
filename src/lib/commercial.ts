import "server-only";
import type { Session } from "./auth";
import { one, rows, withSystem, withUser, type Db } from "./db";
import { requestSignoff } from "./projects";
import { qrTlv } from "./zatca";

/* Progress claims (retention, advance recovery), retention release, credit/debit notes, payments, statement of account and ageing. */

export class CommercialError extends Error {}
const r2 = (n: number) => Math.round(n * 100) / 100;
const FIN = ["admin", "finance", "ops_manager"];
const ref = async (db: Db, table: string, prefix: string, orgId: string, pad = 4) =>
  (await one<{ ref: string }>(db, `select '${prefix}-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, ${pad}, '0') ref from ${table} where org_id = $1 and ref like '${prefix}-%'`, [orgId]))!.ref;

export type ClaimPreview = {
  certified_work: number; approved_vos: number; gross_cumulative: number; previous_gross: number; this_gross: number;
  retention_pct: number; retention: number; advance_amount: number; advance_recovered: number; advance_recovery: number; net: number; vat: number; total: number;
  lines: { code: string; name: string; uom: string; qty: number; rate: number; amount: number }[]; vos: { ref: string; title: string; amount: number }[];
};

/** What the next claim would be: certified work + approved variations to date, less what was already claimed, retention and advance recovery. */
export async function claimPreview(db: Db, projectId: string): Promise<ClaimPreview> {
  const p = await one<{ contract_value: string; retention_pct: string; advance_pct: string; advance_paid_on: string | null }>(db, "select contract_value, retention_pct, advance_pct, advance_paid_on from projects where id = $1", [projectId]);
  if (!p) throw new CommercialError("Project not found.");
  const lines = (await rows<{ code: string; name: string; uom: string; qty: string; rate: string }>(db, "select code, name, uom, approved_qty qty, rate from project_areas where project_id = $1 and approved_qty > 0 order by sort", [projectId]))
    .map((l) => ({ code: l.code, name: l.name, uom: l.uom, qty: Number(l.qty), rate: Number(l.rate), amount: r2(Number(l.qty) * Number(l.rate)) }));
  const vos = (await rows<{ ref: string; title: string; amount: string }>(db, "select ref, title, amount from variations where project_id = $1 and status = 'approved' order by ref", [projectId])).map((v) => ({ ...v, amount: Number(v.amount) }));
  const prev = await one<{ gross: string; recovered: string }>(db, "select coalesce(max(gross_cumulative), 0) gross, coalesce(sum(advance_recovery), 0) recovered from payment_claims where project_id = $1 and status in ('certified','invoiced')", [projectId]);
  const certified = r2(lines.reduce((t, l) => t + l.amount, 0));
  const voTotal = r2(vos.reduce((t, v) => t + v.amount, 0));
  const gross = r2(certified + voTotal);
  const previous = Number(prev!.gross);
  const thisGross = r2(gross - previous);
  const retentionPct = Number(p.retention_pct);
  const retention = r2((thisGross * retentionPct) / 100);
  const advanceAmount = p.advance_paid_on ? r2((Number(p.contract_value) * Number(p.advance_pct)) / 100) : 0;
  const recovered = Number(prev!.recovered);
  const recovery = r2(Math.max(0, Math.min((thisGross * Number(p.advance_pct)) / 100, advanceAmount - recovered)));
  const net = r2(thisGross - retention - recovery);
  const vat = r2(net * 0.15);
  return { certified_work: certified, approved_vos: voTotal, gross_cumulative: gross, previous_gross: previous, this_gross: thisGross, retention_pct: retentionPct, retention, advance_amount: advanceAmount, advance_recovered: recovered, advance_recovery: recovery, net, vat, total: r2(net + vat), lines, vos };
}

export async function submitClaim(s: Session, projectId: string) {
  if (!FIN.includes(s.role)) throw new CommercialError("Only finance or operations can submit claims.");
  return withSystem(async (db) => {
    const p = await one<{ org_id: string; client_company_id: string; ref: string }>(db, "select org_id, client_company_id, ref from projects where id = $1", [projectId]);
    if (!p || p.org_id !== s.orgId) throw new CommercialError("Project not found.");
    if (await one(db, "select 1 from payment_claims where project_id = $1 and status = 'submitted'", [projectId])) throw new CommercialError("A claim is already waiting for the client to certify.");
    const c = await claimPreview(db, projectId);
    if (c.this_gross <= 0) throw new CommercialError("Nothing new to claim: get the latest measurement sheet signed first.");
    const seq = (await one<{ n: number }>(db, "select count(*)::int + 1 n from payment_claims where project_id = $1", [projectId]))!.n;
    const cref = await ref(db, "payment_claims", "PC", s.orgId);
    const cl = await one<{ id: string }>(db, `insert into payment_claims (org_id, client_company_id, project_id, ref, seq, period_to, gross_cumulative, previous_gross, this_gross, retention, advance_recovery, net, vat, total, lines, status, submitted_by)
      values ($1,$2,$3,$4,$5, current_date, $6,$7,$8,$9,$10,$11,$12,$13,$14,'submitted',$15) returning id`,
      [s.orgId, p.client_company_id, projectId, cref, seq, c.gross_cumulative, c.previous_gross, c.this_gross, c.retention, c.advance_recovery, c.net, c.vat, c.total, JSON.stringify({ work: c.lines, vos: c.vos }), s.id]);
    await requestSignoff(db, { orgId: s.orgId, clientCompanyId: p.client_company_id, projectId, kind: "claim", entityType: "payment_claim", entityId: cl!.id,
      title: `Payment claim ${cref} (No. ${seq})`, titleAr: `مطالبة دفع ${cref} (رقم ${seq})`,
      summary: `This claim SAR ${c.this_gross.toLocaleString("en")} less retention ${c.retention.toLocaleString("en")} and advance recovery ${c.advance_recovery.toLocaleString("en")} = net ${c.net.toLocaleString("en")} + VAT.`, amount: c.total, dueInDays: 7, requestedBy: s.id });
    return `${cref} sent to the client to certify: net SAR ${c.net.toLocaleString("en")} + VAT.`;
  }, { actorId: s.id });
}

/** Client certified a claim: it becomes a draft progress invoice for Finance to issue. */
export async function onClaimCertified(db: Db, claimId: string, status: "approved" | "rejected") {
  if (status === "rejected") { await db.query("update payment_claims set status = 'rejected' where id = $1", [claimId]); return "Claim returned to RGS."; }
  const c = await one<{ org_id: string; client_company_id: string; project_id: string; ref: string; this_gross: string; retention: string; advance_recovery: string; net: string; vat: string; total: string }>(db, "select * from payment_claims where id = $1", [claimId]);
  if (!c) return "";
  const p = await one<{ site_id: string | null; job_id: string | null; po_number: string | null; retention_pct: string }>(db, "select site_id, job_id, po_number, retention_pct from projects where id = $1", [c.project_id]);
  const iref = await ref(db, "invoices", "INV", c.org_id);
  const inv = await one<{ id: string }>(db, `insert into invoices (org_id, client_company_id, site_id, job_id, project_id, payment_claim_id, kind, ref, period_to, status, subtotal, vat, total, po_number, due_date, created_by_agent, notes)
    values ($1,$2,$3,$4,$5,$6,'progress',$7, current_date, 'draft', $8,$9,$10,$11, current_date + 60, true, $12) returning id`,
    [c.org_id, c.client_company_id, p?.site_id, p?.job_id, c.project_id, claimId, iref, c.net, c.vat, c.total, p?.po_number, `From certified claim ${c.ref}.`]);
  const L = (d: string, ar: string, amt: number) => db.query("insert into invoice_lines (org_id, invoice_id, description, description_ar, qty, unit, rate, amount) values ($1,$2,$3,$4,1,'lot',$5,$5)", [c.org_id, inv!.id, d, ar, amt]);
  await L(`Work certified this period (${c.ref})`, `الأعمال المعتمدة لهذه الفترة (${c.ref})`, Number(c.this_gross));
  await L(`Less retention ${p?.retention_pct}%`, `خصم المحتجزات ${p?.retention_pct}%`, -Number(c.retention));
  if (Number(c.advance_recovery)) await L("Less advance payment recovery", "خصم استرداد الدفعة المقدمة", -Number(c.advance_recovery));
  await db.query("update payment_claims set status = 'certified', invoice_id = $2 where id = $1", [claimId, inv!.id]);
  await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) values ($1,'finance','claim_certified',$2,$3,$4)", [c.org_id, `${c.ref} certified by the client: issue ${iref}`, `اعتماد ${c.ref}: أصدر ${iref}`, `/ops/billing/${inv!.id}`]);
  return `Claim certified. RGS will issue invoice ${iref}.`;
}

export async function listClaims(s: Session, projectId?: string) {
  return withUser(s, (db) => rows<{ id: string; ref: string; seq: number; project_id: string; project_ref: string; period_to: string; gross_cumulative: string; previous_gross: string; this_gross: string; retention: string; advance_recovery: string; net: string; vat: string; total: string; status: string; invoice_ref: string | null; invoice_id: string | null }>(db,
    `select c.id, c.ref, c.seq, c.project_id, p.ref project_ref, c.period_to::text, c.gross_cumulative, c.previous_gross, c.this_gross, c.retention, c.advance_recovery, c.net, c.vat, c.total, c.status, i.ref invoice_ref, i.id invoice_id
     from payment_claims c join projects p on p.id = c.project_id left join invoices i on i.id = c.invoice_id where ($1::uuid is null or c.project_id = $1) order by p.ref, c.seq desc`, [projectId ?? null]));
}

export async function retentionPosition(s: Session, projectId: string) {
  return withUser(s, async (db) => {
    const r = await one<{ held: string; released: string; status: string; completed_on: string | null; dlp_months: number }>(db,
      `select coalesce((select sum(retention) from payment_claims where project_id = $1 and status in ('certified','invoiced')), 0) held,
              coalesce((select sum(subtotal) from invoices where project_id = $1 and kind = 'retention_release' and status <> 'void'), 0) released,
              p.status, (select min(starts_on)::text from warranties where project_id = $1 and status = 'active') completed_on, p.dlp_months
       from projects p where p.id = $1`, [projectId]);
    const held = Number(r!.held), released = Number(r!.released);
    const dlpEnd = r!.completed_on ? new Date(new Date(r!.completed_on).setMonth(new Date(r!.completed_on).getMonth() + r!.dlp_months)) : null;
    return { held, released, outstanding: r2(held - released), completed: r!.status === "completed", completed_on: r!.completed_on, dlp_end: dlpEnd?.toISOString().slice(0, 10) ?? null,
      first_half_due: r!.status === "completed" && released < held / 2 - 0.01, second_half_due: !!dlpEnd && dlpEnd <= new Date() && released < held - 0.01 };
  });
}

/** 50% of retention at completion, the rest after the defects liability period. */
export async function releaseRetention(s: Session, projectId: string) {
  if (!FIN.includes(s.role)) throw new CommercialError("Only finance or operations can release retention.");
  const pos = await retentionPosition(s, projectId);
  if (!pos.first_half_due && !pos.second_half_due) throw new CommercialError(pos.completed ? `Second half is due after the defects liability period (${pos.dlp_end}).` : "Retention is released from completion: get the completion sign-off first.");
  const amount = r2(pos.first_half_due ? pos.held / 2 - pos.released : pos.held - pos.released);
  return withSystem(async (db) => {
    const p = await one<{ org_id: string; client_company_id: string; site_id: string | null; po_number: string | null; ref: string }>(db, "select org_id, client_company_id, site_id, po_number, ref from projects where id = $1", [projectId]);
    const iref = await ref(db, "invoices", "INV", p!.org_id);
    const vat = r2(amount * 0.15);
    const inv = await one<{ id: string }>(db, `insert into invoices (org_id, client_company_id, site_id, project_id, kind, ref, status, subtotal, vat, total, po_number, due_date, notes) values ($1,$2,$3,$4,'retention_release',$5,'draft',$6,$7,$8,$9, current_date + 30, $10) returning id`,
      [p!.org_id, p!.client_company_id, p!.site_id, projectId, iref, amount, vat, amount + vat, p!.po_number, `${pos.first_half_due ? "First" : "Final"} retention release, ${p!.ref}.`]);
    await db.query("insert into invoice_lines (org_id, invoice_id, description, description_ar, qty, unit, rate, amount) values ($1,$2,$3,$4,1,'lot',$5,$5)",
      [p!.org_id, inv!.id, `${pos.first_half_due ? "Release of 50% retention at completion" : "Release of remaining retention after defects liability period"} (${p!.ref})`, pos.first_half_due ? "الإفراج عن 50% من المحتجزات عند الإنجاز" : "الإفراج عن باقي المحتجزات بعد فترة الضمان", amount]);
    return `${iref} drafted to release SAR ${amount.toLocaleString("en")} retention.`;
  }, { actorId: s.id });
}

// ───────────────────────── Credit / debit notes ─────────────────────────

export async function createCreditNote(s: Session, x: { invoiceRef: string; kind: "credit" | "debit"; reason: string; amount: number; description: string }) {
  if (!FIN.includes(s.role)) throw new CommercialError("Only finance can raise credit or debit notes.");
  if (!(x.amount > 0)) throw new CommercialError("Enter an amount above zero (before VAT).");
  if (x.reason.trim().length < 10) throw new CommercialError("Explain the reason (the client sees it).");
  const inv = await withUser(s, (db) => one<{ id: string; org_id: string; client_company_id: string; status: string; subtotal: string }>(db, "select id, org_id, client_company_id, status, subtotal from invoices where ref = $1", [x.invoiceRef]));
  if (!inv) throw new CommercialError(`Invoice ${x.invoiceRef} not found.`);
  if (!["issued", "paid"].includes(inv.status)) throw new CommercialError("Credit and debit notes adjust issued invoices only.");
  if (x.kind === "credit" && x.amount > Number(inv.subtotal)) throw new CommercialError("A credit note can't exceed the original invoice.");
  return withSystem(async (db) => {
    const cref = await ref(db, "credit_notes", x.kind === "credit" ? "CN" : "DN", s.orgId, 3);
    const vat = r2(x.amount * 0.15);
    await db.query(`insert into credit_notes (org_id, client_company_id, invoice_id, ref, kind, reason, lines, subtotal, vat, total, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [s.orgId, inv.client_company_id, inv.id, cref, x.kind, x.reason, JSON.stringify([{ description: x.description, amount: x.amount }]), x.amount, vat, r2(x.amount + vat), s.id]);
    return cref;
  }, { actorId: s.id });
}

export async function issueCreditNote(s: Session, cref: string) {
  const cn = await withUser(s, (db) => one<{ id: string; status: string; total: string; vat: string; org_id: string; client_company_id: string; invoice_id: string; kind: string }>(db, "select * from credit_notes where ref = $1", [cref]));
  if (!cn) return { ok: false as const, error: `${cref} not found.` };
  if (cn.status === "issued") return { ok: false as const, error: `${cref} is already issued.` };
  await withSystem(async (db) => {
    await db.query("update credit_notes set status = 'issued', issued_at = now(), qr_tlv = $2 where id = $1", [cn.id, qrTlv({ issuedAt: new Date(), total: Number(cn.total), vat: Number(cn.vat) })]);
    await settleInvoice(db, cn.invoice_id);
    await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) values ($1,$2,'credit_note',$3,$4,'/client/statement')",
      [cn.org_id, cn.client_company_id, `${cn.kind === "credit" ? "Credit" : "Debit"} note ${cref} issued: SAR ${Number(cn.total).toLocaleString("en")}`, `${cn.kind === "credit" ? "إشعار دائن" : "إشعار مدين"} ${cref}`]);
  }, { actorId: s.id });
  return { ok: true as const, ref: cref, total: Number(cn.total) };
}

export async function listCreditNotes(s: Session) {
  return withUser(s, (db) => rows<{ id: string; ref: string; kind: string; reason: string; subtotal: string; vat: string; total: string; status: string; issued_at: string | null; invoice_ref: string; client: string }>(db,
    `select cn.id, cn.ref, cn.kind, cn.reason, cn.subtotal, cn.vat, cn.total, cn.status, cn.issued_at, i.ref invoice_ref, c.name client
     from credit_notes cn join invoices i on i.id = cn.invoice_id join client_companies c on c.id = cn.client_company_id order by cn.created_at desc`));
}

// ───────────────────────── Payments, statement, ageing ─────────────────────────

/** Mark an invoice paid once payments and credit notes cover it. */
async function settleInvoice(db: Db, invoiceId: string) {
  await db.query(`update invoices i set status = 'paid' where i.id = $1 and i.status = 'issued' and
    i.total <= coalesce((select sum(amount) from payments where invoice_id = i.id), 0)
             + coalesce((select sum(case when kind = 'credit' then total else -total end) from credit_notes where invoice_id = i.id and status = 'issued'), 0) + 0.01`, [invoiceId]);
}

export async function recordPayment(s: Session, x: { invoiceRef: string; amount: number; paidOn: string; reference?: string; method?: string }) {
  if (!["admin", "finance"].includes(s.role)) throw new CommercialError("Only finance records payments.");
  if (!(x.amount > 0)) throw new CommercialError("Enter the amount received.");
  const inv = await withUser(s, (db) => one<{ id: string; client_company_id: string; status: string }>(db, "select id, client_company_id, status from invoices where ref = $1", [x.invoiceRef]));
  if (!inv || !["issued", "paid"].includes(inv.status)) throw new CommercialError(`Invoice ${x.invoiceRef} isn't issued.`);
  await withSystem(async (db) => {
    await db.query("insert into payments (org_id, client_company_id, invoice_id, amount, paid_on, method, reference, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [s.orgId, inv.client_company_id, inv.id, x.amount, x.paidOn, x.method ?? "bank_transfer", x.reference ?? null, s.id]);
    await settleInvoice(db, inv.id);
  }, { actorId: s.id });
  return `Payment of SAR ${x.amount.toLocaleString("en")} recorded on ${x.invoiceRef}.`;
}

export type StatementLine = { date: string; ref: string; kind: string; description: string; debit: number; credit: number; balance: number; client: string };

export async function statementOfAccount(s: Session, clientCompanyId?: string) {
  return withUser(s, async (db) => {
    const ev = await rows<{ date: string; ref: string; kind: string; description: string; debit: string; credit: string; client: string; client_id: string }>(db,
      `select * from (
         select coalesce(i.issued_at, i.created_at)::date::text date, i.ref, 'invoice' kind, i.kind || ' invoice' || coalesce(' · ' || p.ref, '') description, i.total debit, 0 credit, c.name client, c.id client_id
           from invoices i join client_companies c on c.id = i.client_company_id left join projects p on p.id = i.project_id where i.status in ('issued','paid')
         union all
         select cn.issued_at::date::text, cn.ref, cn.kind || '_note', cn.reason, case when cn.kind = 'debit' then cn.total else 0 end, case when cn.kind = 'credit' then cn.total else 0 end, c.name, c.id
           from credit_notes cn join client_companies c on c.id = cn.client_company_id where cn.status = 'issued'
         union all
         select pm.paid_on::text, coalesce(pm.reference, 'PAY'), 'payment', 'Payment for ' || i.ref, 0, pm.amount, c.name, c.id
           from payments pm join invoices i on i.id = pm.invoice_id join client_companies c on c.id = pm.client_company_id
       ) x where ($1::uuid is null or client_id = $1) order by date, kind = 'payment'`, [clientCompanyId ?? null]);
    let bal = 0;
    const lines: StatementLine[] = ev.map((e) => { bal = r2(bal + Number(e.debit) - Number(e.credit)); return { date: e.date, ref: e.ref, kind: e.kind, description: e.description, debit: Number(e.debit), credit: Number(e.credit), balance: bal, client: e.client }; });
    const open = await rows<{ ref: string; client: string; due_date: string | null; total: string; paid: string; credited: string; days: number }>(db,
      `select i.ref, c.name client, i.due_date::text, i.total,
              coalesce((select sum(amount) from payments where invoice_id = i.id), 0) paid,
              coalesce((select sum(case when kind = 'credit' then total else -total end) from credit_notes where invoice_id = i.id and status = 'issued'), 0) credited,
              greatest(0, current_date - coalesce(i.due_date, current_date))::int days
       from invoices i join client_companies c on c.id = i.client_company_id where i.status = 'issued' and ($1::uuid is null or i.client_company_id = $1) order by i.due_date`, [clientCompanyId ?? null]);
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
    const openItems = open.map((o) => {
      const outstanding = r2(Number(o.total) - Number(o.paid) - Number(o.credited));
      const b = o.days === 0 ? "current" : o.days <= 30 ? "d30" : o.days <= 60 ? "d60" : o.days <= 90 ? "d90" : "over90";
      buckets[b] = r2(buckets[b] + outstanding);
      return { ...o, outstanding, bucket: b };
    }).filter((o) => o.outstanding > 0.01);
    return { lines, balance: bal, open: openItems, buckets, total_outstanding: r2(openItems.reduce((t, o) => t + o.outstanding, 0)) };
  });
}
