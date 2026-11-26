import { getTranslations } from "next-intl/server";
import { Card, PageHeader } from "@/components/ui";
import { InvoiceTable } from "@/components/invoice-table";
import { requireSession } from "@/lib/auth";
import { invoicesList } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const list = await invoicesList(s);
  return (
    <>
      <PageHeader title={t("nav.finance")} sub={t("pages.financeSub")} />
      <Card><InvoiceTable list={list} /></Card>
    </>
  );
}
