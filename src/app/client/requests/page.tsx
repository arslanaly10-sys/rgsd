import { getLocale, getTranslations } from "next-intl/server";
import { Card, Mono, PageHeader, Pill, statusTone, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDate, fmtSAR, type Loc } from "@/lib/format";
import { requestsList } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("client");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const reqs = await requestsList(s);
  return (
    <>
      <PageHeader title={t("nav.requests")} sub={t("pages.requestsSub")} />
      <Card>
        <Table head={[t("cols.ref"), t("cols.title"), t("cols.source"), t("cols.requiredBy"), t("cols.status"), "Quote"]} empty={reqs.length ? undefined : t("app.none")}>
          {reqs.map((r) => (
            <tr key={r.id}>
              <Td><Mono>{r.ref}</Mono></Td>
              <Td className="max-w-[360px] font-medium">{r.title}</Td>
              <Td><Pill>{t(`types.${r.source}`)}</Pill></Td>
              <Td className="whitespace-nowrap">{fmtDate(r.required_by, l)}</Td>
              <Td><Pill tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Pill></Td>
              <Td>{r.quote_ref ? <><Mono>{r.quote_ref}</Mono> <span className="text-xs text-muted">{fmtSAR(r.quote_total, l)}</span></> : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
