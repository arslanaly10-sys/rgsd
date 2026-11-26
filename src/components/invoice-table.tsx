import { getLocale, getTranslations } from "next-intl/server";
import { Mono, Pill, statusTone, Table, Td } from "@/components/ui";
import { fmtDate, fmtSAR, L, type Loc } from "@/lib/format";
import type { invoicesList } from "@/lib/queries";

export async function InvoiceTable({ list, showClient = true }: { list: Awaited<ReturnType<typeof invoicesList>>; showClient?: boolean }) {
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  return (
    <Table head={[t("cols.ref"), ...(showClient ? [t("cols.client")] : []), t("cols.site"), t("cols.period"), t("cols.total"), t("cols.due"), t("cols.status"), t("cols.zatca")]} empty={list.length ? undefined : t("app.none")}>
      {list.map((i) => (
        <tr key={i.id}>
          <Td><Mono>{i.ref}</Mono></Td>
          {showClient && <Td className="max-w-[220px] text-muted">{L(i, "client", l)}</Td>}
          <Td><Mono>{i.site_code ?? "—"}</Mono></Td>
          <Td className="whitespace-nowrap text-muted">{fmtDate(i.period_from, l)} – {fmtDate(i.period_to, l)}</Td>
          <Td className="tabular whitespace-nowrap font-medium">{fmtSAR(i.total, l, 2)}</Td>
          <Td className="whitespace-nowrap">{fmtDate(i.due_date, l)}</Td>
          <Td><Pill tone={statusTone(i.status)}>{t(`status.${i.status}`)}</Pill></Td>
          <Td><Pill tone={statusTone(i.zatca_status)}>{t(`status.${i.zatca_status}`)}</Pill></Td>
        </tr>
      ))}
    </Table>
  );
}

