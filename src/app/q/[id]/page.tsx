import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { loadQuote, QuoteDocument } from "@/components/quote-document";
import { requireSession } from "@/lib/auth";

export default async function QuotePrint({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await loadQuote(s, id); // RLS: clients only see quotes that were sent to them
  if (!data) notFound();
  return (
    <div className="min-h-dvh bg-canvas px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[900px] items-center justify-between print:hidden">
        <Link href={s.isStaff ? `/ops/quotes/${id}` : `/client/quotes/${id}`} className="text-sm text-muted hover:text-ink">← Back</Link>
        <PrintButton label="Print / Save PDF" />
      </div>
      <QuoteDocument data={data} />
    </div>
  );
}
