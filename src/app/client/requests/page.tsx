import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Mono, PageHeader, Pill, statusTone, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDate, fmtSAR, type Loc } from "@/lib/format";
import { requestsList, siteOptions } from "@/lib/queries";
import { createClientRequest } from "@/lib/actions/quotes";
import { SubmitButton } from "@/components/submit-button";
import { Flash } from "@/components/ui";
import { L } from "@/lib/format";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const [reqs, sites] = await Promise.all([requestsList(s), siteOptions(s)]);
  const { msg } = await searchParams;
  const ar = l === "ar";
  const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm";
  return (
    <>
      <PageHeader title={t("nav.requests")} sub={t("pages.requestsSub")} />
      <Flash msg={msg} />
      <Card title={t("client.newRequest")} className="mb-4">
        <form action={createClientRequest} className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1"><label htmlFor="title" className="text-xs font-medium text-muted">{ar ? "ما المطلوب؟" : "What do you need?"}</label><input id="title" name="title" required minLength={5} className={field} placeholder={ar ? "مثال: سقالة لاستبدال صمام" : "e.g. Access for valve replacement under cellar deck"} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1"><label htmlFor="site" className="text-xs font-medium text-muted">{t("cols.site")}</label><select id="site" name="site" className={field}>{sites.map((x) => <option key={x.code} value={x.code}>{x.code} · {L(x, "name", l)}</option>)}</select></div>
            <div className="grid gap-1"><label htmlFor="days" className="text-xs font-medium text-muted">{ar ? "مطلوب خلال (أيام)" : "Needed in (days)"}</label><input id="days" name="days" type="number" min={0} max={365} defaultValue={7} className={field} /></div>
          </div>
          <div className="grid gap-1 md:col-span-2"><label htmlFor="description" className="text-xs font-medium text-muted">{ar ? "التفاصيل: الأبعاد والارتفاع ومدة الإيجار" : "Details: dimensions, working height, hire period, access"}</label><textarea id="description" name="description" rows={3} className={field} placeholder={ar ? "مثال: بطول 8 م وعرض 1.3 م، مستويان، لمدة 3 أسابيع" : "e.g. 8 m long, 1.3 m wide, 2 lifts, 3 weeks, offshore crew change Thursday"} /></div>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <label htmlFor="file" className="text-xs font-medium text-muted">{ar ? "مخطط أو صورة (اختياري)" : "Drawing, RFQ or photo (optional)"}</label>
            <input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" className="min-w-0 flex-1 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold" />
            <SubmitButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" pending={ar ? "جارٍ الإرسال…" : "Sending…"}>{ar ? "إرسال الطلب" : "Send request"}</SubmitButton>
          </div>
        </form>
      </Card>
      <Card>
        <Table head={[t("cols.ref"), t("cols.title"), t("cols.source"), t("cols.requiredBy"), t("cols.status"), "Quote"]} empty={reqs.length ? undefined : t("app.none")}>
          {reqs.map((r) => (
            <tr key={r.id}>
              <Td><Mono>{r.ref}</Mono></Td>
              <Td className="max-w-[360px] font-medium">{r.title}</Td>
              <Td><Pill>{t(`types.${r.source}`)}</Pill></Td>
              <Td className="whitespace-nowrap">{fmtDate(r.required_by, l)}</Td>
              <Td><Pill tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Pill></Td>
              <Td>{r.quote_ref && r.quote_id ? <><Link href={`/client/quotes/${r.quote_id}`} className="text-brand"><Mono>{r.quote_ref}</Mono></Link> <span className="text-xs text-muted">{fmtSAR(r.quote_total, l)}</span></> : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
