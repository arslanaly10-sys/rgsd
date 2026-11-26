import Image from "next/image";
import QRCode from "qrcode";
import type { Session } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { fmtDate, fmtNum, fmtSAR } from "@/lib/format";
import { decodeTlv, SELLER } from "@/lib/zatca";

export async function loadInvoice(s: Session, id: string) {
  return withUser(s, async (db) => {
    const inv = await one<{ id: string; ref: string; status: string; period_from: string | null; period_to: string | null; subtotal: string; vat: string; total: string; po_number: string | null; due_date: string | null; issued_at: string | null; zatca_status: string; zatca_uuid: string | null; qr_tlv: string | null; notes: string | null; created_by_agent: boolean; client: string; client_ar: string | null; client_vat: string | null; site: string | null; site_code: string | null }>(db,
      `select i.*, c.name client, c.name_ar client_ar, c.vat_number client_vat, si.name site, si.code site_code from invoices i join client_companies c on c.id = i.client_company_id left join sites si on si.id = i.site_id where i.id = $1`, [id]);
    if (!inv) return null;
    const lines = await rows<{ description: string; description_ar: string | null; qty: string; unit: string; rate: string; amount: string }>(db, "select description, description_ar, qty, unit, rate, amount from invoice_lines where invoice_id = $1 order by description", [id]);
    return { inv, lines };
  });
}

/** Bilingual tax invoice with the ZATCA QR (TLV) once issued. */
export async function TaxInvoice({ data }: { data: NonNullable<Awaited<ReturnType<typeof loadInvoice>>> }) {
  const { inv, lines } = data;
  const qr = inv.qr_tlv ? await QRCode.toString(inv.qr_tlv, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  const tlv = inv.qr_tlv ? decodeTlv(inv.qr_tlv) : null;
  return (
    <article className="relative mx-auto max-w-[900px] overflow-hidden rounded-xl border border-line bg-white p-6 text-[13px] text-ink sm:p-10 print:border-0 print:p-0" dir="ltr">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[96px] font-bold text-ink/[0.035] [transform:rotate(-24deg)]" aria-hidden>SAMPLE</div>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-brand pb-5">
        <div className="flex items-center gap-3">
          <Image src="/brand/rgs-logo.png" alt="RGS" width={56} height={56} />
          <div><div className="font-display text-lg font-semibold">{SELLER.name}</div><div className="text-xs text-muted">{SELLER.address} · VAT {SELLER.vat}</div></div>
        </div>
        <div className="text-end" dir="rtl"><div className="text-lg font-semibold">{SELLER.nameAr}</div><div className="text-xs text-muted">الرقم الضريبي {SELLER.vat}</div></div>
      </header>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Tax Invoice <span className="text-muted">·</span> <span dir="rtl">فاتورة ضريبية</span></h1>
          <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs">
            <dt className="text-muted">Invoice no. / رقم الفاتورة</dt><dd className="font-mono font-medium">{inv.ref}</dd>
            <dt className="text-muted">Issue date / تاريخ الإصدار</dt><dd>{inv.issued_at ? fmtDate(inv.issued_at, "en") : "Not issued (draft)"}</dd>
            <dt className="text-muted">Period / الفترة</dt><dd>{fmtDate(inv.period_from, "en")} – {fmtDate(inv.period_to, "en")}</dd>
            <dt className="text-muted">PO / أمر الشراء</dt><dd>{inv.po_number ?? "—"}</dd>
            <dt className="text-muted">Due / الاستحقاق</dt><dd>{fmtDate(inv.due_date, "en")}</dd>
          </dl>
        </div>
        {qr ? (
          <div className="text-center"><div className="size-28 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} /><div className="mt-1 text-[10px] text-muted">ZATCA QR</div></div>
        ) : <div className="rounded-lg border border-dashed border-line p-4 text-xs text-muted">QR added on issue</div>}
      </div>
      <section className="mt-5 grid gap-4 rounded-lg bg-canvas p-4 sm:grid-cols-2">
        <div><div className="eyebrow">Buyer</div><div className="font-medium">{inv.client}</div>{inv.client_vat && <div className="text-xs text-muted">VAT {inv.client_vat}</div>}{inv.site && <div className="mt-1 text-xs">Site: {inv.site_code} · {inv.site}</div>}</div>
        <div dir="rtl"><div className="eyebrow">المشتري</div><div className="font-medium">{inv.client_ar ?? inv.client}</div></div>
      </section>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse">
          <thead><tr className="bg-ink text-[11px] text-white"><th className="px-2 py-2 text-start font-medium">Description / الوصف</th><th className="px-2 py-2 text-end font-medium">Qty (item-days)</th><th className="px-2 py-2 text-end font-medium">Rate</th><th className="px-2 py-2 text-end font-medium">Amount (SAR)</th></tr></thead>
          <tbody>
            {lines.map((x, i) => (
              <tr key={i} className="border-b border-line align-top">
                <td className="px-2 py-2">{x.description}<div className="text-xs text-muted" dir="rtl">{x.description_ar}</div></td>
                <td className="px-2 py-2 text-end tabular">{fmtNum(x.qty, "en")}</td>
                <td className="px-2 py-2 text-end tabular">{fmtNum(x.rate, "en", 3)}</td>
                <td className="px-2 py-2 text-end tabular font-medium">{fmtNum(x.amount, "en", 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ms-auto mt-4 grid w-full max-w-sm gap-1 tabular">
        <div className="flex justify-between"><dt>Total excl. VAT <span className="text-muted">/ الإجمالي غير شامل الضريبة</span></dt><dd>{fmtSAR(inv.subtotal, "en", 2)}</dd></div>
        <div className="flex justify-between"><dt>VAT 15% <span className="text-muted">/ ضريبة القيمة المضافة</span></dt><dd>{fmtSAR(inv.vat, "en", 2)}</dd></div>
        <div className="flex justify-between border-t-2 border-ink pt-1 text-base font-semibold"><dt>Total incl. VAT <span className="text-muted">/ الإجمالي</span></dt><dd>{fmtSAR(inv.total, "en", 2)}</dd></div>
      </dl>
      <footer className="mt-8 grid gap-1 border-t border-line pt-4 text-xs text-muted">
        {tlv && <span>QR contents: {tlv[1]} · VAT {tlv[2]} · {tlv[3]} · total {tlv[4]} · VAT {tlv[5]}</span>}
        <span>ZATCA status: {inv.zatca_status.replace(/_/g, " ")}{inv.zatca_uuid ? ` · UUID ${inv.zatca_uuid}` : ""}. Demo invoice with SAMPLE data; not reported to ZATCA.</span>
      </footer>
    </article>
  );
}
