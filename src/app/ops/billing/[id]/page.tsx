import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ButtonLink, Card, Flash, PageHeader, Pill, statusTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { loadInvoice, TaxInvoice } from "@/components/tax-invoice";
import { requireSession } from "@/lib/auth";
import { submitInvoiceAction } from "@/lib/actions/fleet";

export default async function InvoiceDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const { id } = await params;
  const { msg } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await loadInvoice(s, id);
  if (!data) notFound();
  const { inv } = data;
  return (
    <>
      <Link href="/ops/billing" className="text-sm text-muted hover:text-ink">← {t("nav.finance")}</Link>
      <PageHeader title={`${inv.ref} · ${inv.client}`} sub={inv.created_by_agent ? "Drafted by the Finance agent from unbilled on-hire days." : undefined}
        actions={<><Pill tone={statusTone(inv.status)}>{t(`status.${inv.status}`)}</Pill><ButtonLink href={`/inv/${id}`} variant="ghost">Print view</ButtonLink></>} />
      <Flash msg={msg} />
      {inv.notes && <div className="mb-4 rounded-lg bg-tag-yellow-bg px-4 py-3 text-sm text-tag-yellow">{inv.notes}</div>}
      {inv.status === "draft" && (
        <Card className="mb-4">
          <form action={submitInvoiceAction} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm text-muted">Issuing an invoice is a tier 3 action. Finance approves it; then the ZATCA QR is added, billed periods are locked on each on-hire line and the client sees it in their portal.</p>
            <SubmitButton className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white" pending="Submitting…">Submit for issue</SubmitButton>
          </form>
        </Card>
      )}
      <TaxInvoice data={data} />
    </>
  );
}
