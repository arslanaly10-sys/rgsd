import { getTranslations } from "next-intl/server";
import { Card, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { draftInvoicesAction } from "@/lib/actions/fleet";
import { InvoiceTable } from "@/components/invoice-table";
import { requireSession } from "@/lib/auth";
import { invoicesList } from "@/lib/queries";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const list = await invoicesList(s);
  const { msg } = await searchParams;
  const canDraft = ["admin", "finance", "ops_manager"].includes(s.role);
  return (
    <>
      <PageHeader title={t("nav.finance")} sub={t("pages.financeSub")} actions={canDraft ? <form action={draftInvoicesAction}><SubmitButton className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white" pending="Drafting…">Draft invoices for unbilled days</SubmitButton></form> : undefined} />
      <Flash msg={msg} />
      <Card><InvoiceTable list={list} /></Card>
    </>
  );
}
