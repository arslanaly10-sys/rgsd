import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { loadInvoice, TaxInvoice } from "@/components/tax-invoice";
import { requireSession } from "@/lib/auth";

export default async function InvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await loadInvoice(s, id); // RLS: clients only see issued or paid invoices
  if (!data) notFound();
  return (
    <div className="min-h-dvh bg-canvas px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[900px] items-center justify-between print:hidden">
        <Link href={s.isStaff ? `/ops/billing/${id}` : "/client/billing"} className="text-sm text-muted hover:text-ink">← Back</Link>
        <PrintButton label="Print / Save PDF" />
      </div>
      <TaxInvoice data={data} />
    </div>
  );
}
