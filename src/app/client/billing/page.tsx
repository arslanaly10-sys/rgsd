import { getTranslations } from "next-intl/server";
import { InvoiceTable } from "@/components/invoice-table";
import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { invoicesList } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("client");
  const t = await getTranslations();
  const list = await invoicesList(s);
  return (
    <>
      <PageHeader title={t("nav.finance")} sub={t("pages.financeSub")} />
      <Card><InvoiceTable list={list} showClient={false} linkBase="/inv/" /></Card>
    </>
  );
}
