import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/print-button";
import { requireSession } from "@/lib/auth";
import { one, withUser } from "@/lib/db";
import { fmtDate } from "@/lib/format";

/** Printable scaffold tag insert (A6) with QR code for the field app. */
export default async function Label({ params }: { params: Promise<{ tag: string }> }) {
  const s = await requireSession("staff");
  const tag = decodeURIComponent((await params).tag).toUpperCase();
  if (!/^[A-Z]{3}-\d{4}$/.test(tag)) notFound();
  const sc = await withUser(s, (db) => one<{ tag_no: string; qr_code: string; status: string; location_desc: string | null; load_class: string | null; restrictions: string | null; site_code: string; next_inspection_due: string | null; last_inspected_at: string | null }>(db,
    "select sc.*, si.code site_code from scaffolds sc join sites si on si.id = sc.site_id where sc.tag_no = $1", [tag]));
  if (!sc) notFound();
  const qr = await QRCode.toString(sc.qr_code, { type: "svg", margin: 1, errorCorrectionLevel: "Q" });
  const band = { green: "bg-tag-green", yellow: "bg-[#f2c200]", red: "bg-tag-red" }[sc.status as "green"] ?? "bg-slate-400";
  const word = { green: ["SAFE FOR USE", "آمنة للاستخدام"], yellow: ["RESTRICTED USE", "استخدام مقيد"], red: ["DO NOT USE", "ممنوع الاستخدام"] }[sc.status as "green"] ?? ["NOT TAGGED", "غير موسومة"];
  return (
    <div className="min-h-dvh bg-canvas p-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[105mm] items-center justify-between print:hidden"><Link href={`/ops/scaffolds/${sc.tag_no}`} className="text-sm text-muted">← Back</Link><PrintButton label="Print tag" /></div>
      <div className="mx-auto w-[105mm] overflow-hidden rounded-lg border-2 border-ink bg-white text-ink print:rounded-none">
        <div className={`${band} px-4 py-3 text-center text-white`}>
          <div className="font-display text-2xl font-bold tracking-wide">{word[0]}</div>
          <div className="text-lg font-semibold" dir="rtl">{word[1]}</div>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 p-4">
          <dl className="grid gap-1 text-[12px]">
            <div><dt className="text-[10px] uppercase text-muted">Tag</dt><dd className="font-mono text-lg font-bold">{sc.tag_no}</dd></div>
            <div><dt className="text-[10px] uppercase text-muted">Site / location</dt><dd>{sc.site_code} · {sc.location_desc}</dd></div>
            <div><dt className="text-[10px] uppercase text-muted">Duty</dt><dd>{sc.load_class}</dd></div>
            <div><dt className="text-[10px] uppercase text-muted">Inspected / next due</dt><dd>{fmtDate(sc.last_inspected_at, "en")} / {fmtDate(sc.next_inspection_due, "en")}</dd></div>
            {sc.restrictions && <div><dt className="text-[10px] uppercase text-muted">Restriction</dt><dd className="font-semibold">{sc.restrictions}</dd></div>}
          </dl>
          <div className="w-28 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
        <div className="border-t border-line px-4 py-2 text-[10px] text-muted">Resa Gulf Scaffolding · Scan to view live status and inspection history · SAMPLE</div>
      </div>
    </div>
  );
}
