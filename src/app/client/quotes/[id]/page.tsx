import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ButtonLink, Flash, PageHeader, Pill, statusTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { loadQuote, QuoteDocument } from "@/components/quote-document";
import { requireSession } from "@/lib/auth";
import { clientDecideQuote } from "@/lib/actions/quotes";

export default async function ClientQuote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  const t = await getTranslations();
  const { id } = await params;
  const { msg } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await loadQuote(s, id);
  if (!data) notFound();
  const ar = s.locale === "ar";
  return (
    <>
      <PageHeader title={data.q.ref} actions={<><Pill tone={statusTone(data.q.status)}>{t(`status.${data.q.status}`)}</Pill><ButtonLink href={`/q/${id}`} variant="ghost">{ar ? "طباعة" : "Print / PDF"}</ButtonLink></>} />
      <Flash msg={msg} />
      {data.q.status === "sent" && (
        <form action={clientDecideQuote} className="mx-auto mb-4 flex max-w-[900px] flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand-50 p-4">
          <input type="hidden" name="quoteId" value={id} />
          <p className="me-auto text-sm font-medium">{ar ? "هل توافق على هذا العرض؟" : "Do you accept this quotation?"}</p>
          <input id="note" name="note" placeholder={ar ? "ملاحظة (اختياري)" : "Note or PO number (optional)"} className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm sm:max-w-xs" />
          <SubmitButton name="decision" value="rejected" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm font-semibold">{ar ? "رفض" : "Decline"}</SubmitButton>
          <SubmitButton name="decision" value="accepted" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{ar ? "قبول العرض" : "Accept quotation"}</SubmitButton>
        </form>
      )}
      <QuoteDocument data={data} />
    </>
  );
}
