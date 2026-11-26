import "server-only";
import { randomUUID } from "node:crypto";
import type { Session } from "./auth";
import { one, rows, withSystem, withUser } from "./db";
import { putFile } from "./storage";
import { qrTlv, ublXml } from "./zatca";

/* Rental billing: draft invoices from unbilled on-hire days; issue with ZATCA QR + UBL XML after Finance approval. */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Draft one invoice per site for on-hire days not yet billed up to `asOf` (default: yesterday). Skips sites that already have an unissued invoice. */
export async function draftInvoices(orgId: string, opts: { siteCode?: string; minDays?: number; actorId?: string } = {}) {
  const minDays = opts.minDays ?? 1;
  return withSystem(async (db) => {
    const lines = await rows<{ id: string; site_id: string; site_code: string; client_company_id: string; job_id: string | null; po_number: string | null; sku: string; item: string; item_ar: string | null; qty: string; rate_day: string; from_d: string; to_d: string; days: number }>(db,
      `select oh.id, oh.site_id, si.code site_code, oh.client_company_id, oh.job_id, j.po_number, i.sku, i.name item, i.name_ar item_ar, oh.qty, oh.rate_day,
              greatest(oh.start_date, coalesce(oh.last_billed_until + 1, oh.start_date))::text from_d,
              least(current_date - 1, coalesce(oh.end_date, current_date - 1))::text to_d,
              (least(current_date - 1, coalesce(oh.end_date, current_date - 1)) - greatest(oh.start_date, coalesce(oh.last_billed_until + 1, oh.start_date)) + 1)::int days
       from on_hire oh join sites si on si.id = oh.site_id join items i on i.id = oh.item_id left join jobs j on j.id = oh.job_id
       where oh.org_id = $1 and ($2::text is null or si.code = $2)
         and not exists (select 1 from invoices x where x.site_id = oh.site_id and x.status in ('draft','pending_approval','approved'))`, [orgId, opts.siteCode ?? null]);
    const bySite = new Map<string, typeof lines>();
    for (const l of lines.filter((x) => x.days >= minDays)) bySite.set(l.site_id, [...(bySite.get(l.site_id) ?? []), l]);
    const created: { ref: string; site: string; total: number; missingPo: boolean }[] = [];
    for (const [siteId, ls] of bySite) {
      const amounts = ls.map((l) => r2(Number(l.qty) * l.days * Number(l.rate_day)));
      const subtotal = r2(amounts.reduce((a, b) => a + b, 0));
      if (subtotal <= 0) continue;
      const vat = r2(subtotal * 0.15);
      const ref = await one<{ ref: string }>(db, `select 'INV-' || to_char(now(),'YY') || '-' || lpad((coalesce(max(substring(ref from '\\d+$')::int), 0) + 1)::text, 4, '0') ref from invoices where org_id = $1`, [orgId]);
      const from = ls.map((l) => l.from_d).sort()[0], to = ls.map((l) => l.to_d).sort().at(-1)!;
      const po = ls.find((l) => l.po_number)?.po_number ?? null;
      const inv = await one<{ id: string }>(db,
        `insert into invoices (org_id, client_company_id, site_id, job_id, ref, period_from, period_to, status, subtotal, vat, total, po_number, due_date, created_by_agent, notes)
         values ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11, current_date + 60, true, $12) returning id`,
        [orgId, ls[0].client_company_id, siteId, ls[0].job_id, ref!.ref, from, to, subtotal, vat, subtotal + vat, po, po ? null : "No client PO on the job: get it before issuing."]);
      for (let k = 0; k < ls.length; k++) {
        const l = ls[k];
        await db.query("insert into invoice_lines (org_id, invoice_id, description, description_ar, qty, unit, rate, amount, source) values ($1,$2,$3,$4,$5,'item-day',$6,$7,$8)",
          [orgId, inv!.id, `Rental: ${l.item} (${l.sku}) × ${Number(l.qty)} for ${l.days} day(s), ${l.from_d} to ${l.to_d}`, `إيجار: ${l.item_ar ?? l.item} × ${Number(l.qty)} لمدة ${l.days} يوم`,
            Number(l.qty) * l.days, l.rate_day, amounts[k], JSON.stringify({ on_hire_id: l.id, from: l.from_d, to: l.to_d })]);
      }
      if (!po) await db.query(`insert into tasks (org_id, client_company_id, title, assignee_role, due_date, priority, source, watcher, dedupe_key, entity_type, entity_id)
        values ($1,$2,$3,'finance', current_date + 2, 'high', 'watcher', 'billing', $4, 'invoice', $5) on conflict (org_id, dedupe_key) do nothing`,
        [orgId, ls[0].client_company_id, `Get client PO for ${ref!.ref} (${ls[0].site_code}) before issuing`, `po:${inv!.id}`, inv!.id]);
      created.push({ ref: ref!.ref, site: ls[0].site_code, total: subtotal + vat, missingPo: !po });
    }
    if (created.length) await db.query("insert into notifications (org_id, role, kind, title, title_ar, link) values ($1,'finance','invoice_drafts',$2,$3,'/ops/billing')",
      [orgId, `${created.length} rental invoice draft(s) ready for review`, `${created.length} مسودة فاتورة إيجار جاهزة للمراجعة`]);
    return created;
  }, { actorId: opts.actorId });
}

/** Issue after approval: lock the billed period on each on-hire line, add the ZATCA QR and store the UBL XML. */
export async function issueInvoice(s: Session, ref: string) {
  const inv = await withUser(s, (db) => one<{ id: string; status: string; subtotal: string; vat: string; total: string; client: string; client_vat: string | null; org_id: string }>(db,
    "select i.id, i.status, i.subtotal, i.vat, i.total, c.name client, c.vat_number client_vat, i.org_id from invoices i join client_companies c on c.id = i.client_company_id where i.ref = $1", [ref]));
  if (!inv) return { ok: false as const, error: `Invoice ${ref} not found.` };
  if (!["draft", "pending_approval", "approved"].includes(inv.status)) return { ok: false as const, error: `Invoice ${ref} is already ${inv.status}.` };
  const lines = await withUser(s, (db) => rows<{ description: string; qty: string; unit: string; rate: string; amount: string; source: { on_hire_id?: string; to?: string } | null }>(db, "select description, qty, unit, rate, amount, source from invoice_lines where invoice_id = $1", [inv.id]));
  const issuedAt = new Date();
  const uuid = randomUUID();
  const qr = qrTlv({ issuedAt, total: Number(inv.total), vat: Number(inv.vat) });
  const xml = ublXml({ uuid, ref, issuedAt, buyer: { name: inv.client, vat: inv.client_vat }, lines: lines.map((l) => ({ description: l.description, qty: Number(l.qty), unit: "DAY", rate: Number(l.rate), amount: Number(l.amount) })), subtotal: Number(inv.subtotal), vat: Number(inv.vat), total: Number(inv.total) });
  const key = `${inv.org_id}/invoices/${uuid}.xml`;
  await putFile(key, Buffer.from(xml, "utf8"), "application/xml");
  await withSystem(async (db) => {
    await db.query("update invoices set status='issued', issued_at=$2, zatca_uuid=$3, qr_tlv=$4, xml_path=$5 where id=$1", [inv.id, issuedAt, uuid, qr, key]);
    for (const l of lines) if (l.source?.on_hire_id && l.source.to) await db.query("update on_hire set last_billed_until = greatest(coalesce(last_billed_until, $2::date), $2::date) where id = $1", [l.source.on_hire_id, l.source.to]);
    await db.query("insert into notifications (org_id, client_company_id, kind, title, title_ar, link) select org_id, client_company_id, 'invoice', $2, $3, '/client/billing' from invoices where id = $1",
      [inv.id, `New invoice ${ref}`, `فاتورة جديدة ${ref}`]);
  }, { actorId: s.id });
  return { ok: true as const, ref, total: Number(inv.total), id: inv.id };
}
