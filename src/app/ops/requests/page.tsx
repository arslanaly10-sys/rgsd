import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Mono, PageHeader, Pill, statusTone, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDate, fmtSAR, L, type Loc } from "@/lib/format";
import { quotesList, requestsList } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const [reqs, quotes] = await Promise.all([requestsList(s), quotesList(s)]);
  return (
    <>
      <PageHeader title={t("nav.requests")} sub={t("pages.requestsSub")} />
      <div className="grid gap-4">
        <Card title={t("nav.requests")}>
          <Table head={[t("cols.ref"), t("cols.title"), t("cols.client"), t("cols.source"), t("cols.priority"), t("cols.requiredBy"), t("cols.status"), "Quote"]}>
            {reqs.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/ops/requests/${r.id}`} className="hover:text-brand"><Mono>{r.ref}</Mono></Link></Td>
                <Td className="max-w-[320px]"><Link href={`/ops/requests/${r.id}`} className="font-medium hover:text-brand">{r.title}</Link>{r.site_code && <div className="text-xs text-muted"><Mono>{r.site_code}</Mono></div>}</Td>
                <Td className="max-w-[200px] text-muted">{L(r, "client", l)}</Td>
                <Td><Pill>{t(`types.${r.source}`)}</Pill></Td>
                <Td><Pill tone={statusTone(r.priority)}>{t(`status.${r.priority}`)}</Pill></Td>
                <Td className="whitespace-nowrap">{fmtDate(r.required_by, l)}</Td>
                <Td><Pill tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Pill></Td>
                <Td className="whitespace-nowrap">{r.quote_ref ? <><Mono>{r.quote_ref}</Mono><div className="text-xs text-muted">{t(`status.${r.quote_status}`)} · {fmtSAR(r.quote_total, l)}</div></> : <span className="text-muted">—</span>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Quotes">
          <Table head={[t("cols.ref"), t("cols.client"), "Request", t("cols.status"), t("cols.total"), t("cols.valid"), ""]}>
            {quotes.map((q) => (
              <tr key={q.id}>
                <Td><Link href={`/ops/quotes/${q.id}`} className="hover:text-brand"><Mono>{q.ref}</Mono></Link></Td>
                <Td className="text-muted">{L(q, "client", l)}</Td>
                <Td>{q.request_ref ? <Mono>{q.request_ref}</Mono> : "—"}</Td>
                <Td><Pill tone={statusTone(q.status)}>{t(`status.${q.status}`)}</Pill></Td>
                <Td className="tabular whitespace-nowrap font-medium">{fmtSAR(q.total, l, 2)}</Td>
                <Td className="whitespace-nowrap">{fmtDate(q.valid_until, l)}</Td>
                <Td>{q.ai_generated && <Pill tone="dark">AI draft</Pill>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
