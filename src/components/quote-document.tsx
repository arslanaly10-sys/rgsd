import Image from "next/image";
import type { Session } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { fmtDate, fmtNum, fmtSAR } from "@/lib/format";

export async function loadQuote(s: Session, id: string) {
  return withUser(s, async (db) => {
    const q = await one<{ id: string; ref: string; version: number; status: string; subtotal: string; vat: string; total: string; vat_rate: string; valid_until: string | null; created_at: string; assumptions: string | null; assumptions_ar: string | null; client: string; client_ar: string | null; vat_number: string | null; request_ref: string | null; request_title: string | null; site: string | null; site_ar: string | null; preparer: string | null }>(db,
      `select q.*, c.name client, c.name_ar client_ar, c.vat_number, r.ref request_ref, r.title request_title, si.name site, si.name_ar site_ar, p.full_name preparer
       from quotes q join client_companies c on c.id = q.client_company_id left join requests r on r.id = q.request_id
       left join sites si on si.id = r.site_id left join profiles p on p.id = q.prepared_by where q.id = $1`, [id]);
    if (!q) return null;
    const lines = await rows<{ description: string; description_ar: string | null; qty: string; unit: string; rate: string; amount: string }>(db, "select description, description_ar, qty, unit, rate, amount from quote_lines where quote_id=$1 order by sort", [id]);
    return { q, lines };
  });
}

/** Bilingual (EN | AR) quotation, the layout RGS sends to clients. */
export function QuoteDocument({ data }: { data: NonNullable<Awaited<ReturnType<typeof loadQuote>>> }) {
  const { q, lines } = data;
  return (
    <article className="relative mx-auto max-w-[900px] overflow-hidden rounded-xl border border-line bg-white p-6 text-[13px] text-ink sm:p-10 print:border-0 print:p-0" dir="ltr">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[96px] font-bold text-ink/[0.035] [transform:rotate(-24deg)]" aria-hidden>SAMPLE</div>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-brand pb-5">
        <div className="flex items-center gap-3">
          <Image src="/brand/rgs-logo.png" alt="RGS" width={56} height={56} />
          <div>
            <div className="font-display text-lg font-semibold">Resa Gulf Scaffolding Co. Ltd.</div>
            <div className="text-xs text-muted">Khobar Pavilion, 2nd floor · King Faisal Ibn Abdulaziz St. · Khobar 34421 · KSA</div>
          </div>
        </div>
        <div className="text-end" dir="rtl">
          <div className="text-lg font-semibold">شركة ريسا الخليج للسقالات</div>
          <div className="text-xs text-muted">الخبر، المملكة العربية السعودية</div>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Quotation <span className="text-muted">·</span> <span dir="rtl">عرض سعر</span></h1>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 text-xs">
          <dt className="text-muted">No. / رقم</dt><dd className="font-mono font-medium">{q.ref}{q.version > 1 ? ` rev ${q.version}` : ""}</dd>
          <dt className="text-muted">Date / التاريخ</dt><dd>{fmtDate(q.created_at, "en")}</dd>
          <dt className="text-muted">Valid until / صالح حتى</dt><dd>{fmtDate(q.valid_until, "en")}</dd>
          {q.request_ref && <><dt className="text-muted">Your request / طلبكم</dt><dd className="font-mono">{q.request_ref}</dd></>}
        </dl>
      </div>

      <section className="mt-5 grid gap-4 rounded-lg bg-canvas p-4 sm:grid-cols-2">
        <div>
          <div className="eyebrow">To</div>
          <div className="font-medium">{q.client}</div>
          {q.vat_number && <div className="text-xs text-muted">VAT {q.vat_number}</div>}
          {q.site && <div className="mt-1 text-xs">Site: {q.site}</div>}
        </div>
        <div dir="rtl" className="text-start">
          <div className="eyebrow">إلى</div>
          <div className="font-medium">{q.client_ar ?? q.client}</div>
          {q.site_ar && <div className="mt-1 text-xs">الموقع: {q.site_ar}</div>}
        </div>
      </section>

      {q.request_title && <p className="mt-4"><span className="text-muted">Scope:</span> {q.request_title}</p>}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse">
          <thead>
            <tr className="bg-ink text-start text-[11px] text-white">
              <th className="px-2 py-2 text-start font-medium">#</th>
              <th className="px-2 py-2 text-start font-medium">Description</th>
              <th className="px-2 py-2 text-end font-medium" dir="rtl">الوصف</th>
              <th className="px-2 py-2 text-end font-medium">Qty</th>
              <th className="px-2 py-2 text-start font-medium">Unit</th>
              <th className="px-2 py-2 text-end font-medium">Rate (SAR)</th>
              <th className="px-2 py-2 text-end font-medium">Amount (SAR)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((x, i) => (
              <tr key={i} className="border-b border-line align-top">
                <td className="px-2 py-2 text-muted">{i + 1}</td>
                <td className="px-2 py-2">{x.description}</td>
                <td className="px-2 py-2 text-end" dir="rtl">{x.description_ar}</td>
                <td className="px-2 py-2 text-end tabular">{fmtNum(x.qty, "en", 2)}</td>
                <td className="px-2 py-2 text-muted">{x.unit}</td>
                <td className="px-2 py-2 text-end tabular">{fmtNum(x.rate, "en", 2)}</td>
                <td className="px-2 py-2 text-end tabular font-medium">{fmtNum(x.amount, "en", 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ms-auto mt-4 grid w-full max-w-sm gap-1 tabular">
        <div className="flex justify-between"><dt>Subtotal <span className="text-muted">/ المجموع</span></dt><dd>{fmtSAR(q.subtotal, "en", 2)}</dd></div>
        <div className="flex justify-between"><dt>VAT {Math.round(Number(q.vat_rate) * 100)}% <span className="text-muted">/ ضريبة القيمة المضافة</span></dt><dd>{fmtSAR(q.vat, "en", 2)}</dd></div>
        <div className="flex justify-between border-t-2 border-ink pt-1 text-base font-semibold"><dt>Total <span className="text-muted">/ الإجمالي</span></dt><dd>{fmtSAR(q.total, "en", 2)}</dd></div>
      </dl>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="eyebrow">Assumptions & exclusions</div>
          <ul className="mt-1 list-disc ps-4 text-xs leading-relaxed">{(q.assumptions ?? "").split("\n").filter(Boolean).map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
        <div dir="rtl">
          <div className="eyebrow">الافتراضات والاستثناءات</div>
          <ul className="mt-1 list-disc ps-4 text-xs leading-relaxed">
            {(q.assumptions_ar ?? "الأسعار قيم تجريبية لأغراض العرض.\nلا تشمل تصاريح العميل أو التوقف بسبب الغير.\nيحتسب الإيجار من التسليم حتى الإرجاع.").split("\n").filter(Boolean).map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      </section>
      <footer className="mt-8 flex flex-wrap justify-between gap-4 border-t border-line pt-4 text-xs text-muted">
        <span>Prepared by {q.preparer ?? "RGS Estimating"} · +966 13 812 6611 · info@rgsksa.com</span>
        <span>Demo document with SAMPLE rates. Not a binding offer.</span>
      </footer>
    </article>
  );
}
