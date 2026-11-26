import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink, Card, Kpi, Mono, PageHeader, Pill, statusTone } from "@/components/ui";
import { TagBar } from "@/components/tag-bar";
import { requireSession } from "@/lib/auth";
import { fmtDate, fmtNum, fmtSAR, L, type Loc } from "@/lib/format";
import { clientOverview, opsKpis, siteSummaries } from "@/lib/queries";

export default async function ClientHome() {
  const s = await requireSession("client");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  // Same queries as staff; RLS limits every number to this client's company.
  const [k, sites, o] = await Promise.all([opsKpis(s), siteSummaries(s), clientOverview(s)]);
  const name = l === "ar" && s.fullNameAr ? s.fullNameAr : s.fullName;
  return (
    <>
      <PageHeader
        title={t("client.welcome", { name: name.split(" ")[0] })}
        sub={`${(l === "ar" && s.companyNameAr) || s.companyName} · ${t("client.sub")}`}
        actions={<ButtonLink href="/client/requests">{t("client.newRequest")}</ButtonLink>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi.scaffoldsUp")} value={fmtNum(k!.standing, l)} href="/client/scaffolds" />
        <Kpi label={t("kpi.redTags")} value={fmtNum(k!.red, l)} tone={k!.red ? "red" : "default"} href="/client/scaffolds?status=red" />
        <Kpi label={t("kpi.dueInspection")} value={fmtNum(k!.due, l)} tone={k!.due ? "yellow" : "default"} href="/client/scaffolds?due=1" />
        <Kpi label={t("kpi.onHireDay")} value={fmtSAR(k!.onhire_day, l)} tone="brand" />
      </div>
      <h2 className="eyebrow mt-8 mb-3">{t("client.mySites")}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sites.map((x) => (
          <Link key={x.id} href={`/client/scaffolds?site=${x.code}`} className="rounded-xl border border-line bg-panel p-4 transition hover:border-brand">
            <Mono>{x.code}</Mono>
            <div className="mt-1 font-medium">{L(x, "name", l)}</div>
            <div className="mt-3"><TagBar green={x.green} yellow={x.yellow} red={x.red} /></div>
            <div className="mt-2 flex gap-3 text-xs text-muted tabular">
              <span>{t("client.tagged", { count: x.green + x.yellow + x.red })}</span>
              {x.red > 0 && <span className="font-semibold text-tag-red">{t("client.redAtSite", { count: x.red })}</span>}
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title={t("nav.requests")}>
          <ul className="grid gap-2 text-sm">{o.reqs.map((r) => <li key={r.ref} className="flex justify-between gap-2"><span className="min-w-0 truncate"><Mono>{r.ref}</Mono> {r.title}</span><Pill tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Pill></li>)}</ul>
        </Card>
        <Card title={t("client.openQuotes")}>
          <ul className="grid gap-2 text-sm">{o.quotes.length ? o.quotes.map((q) => <li key={q.ref} className="flex justify-between gap-2"><span><Mono>{q.ref}</Mono> <span className="text-xs text-muted">{fmtDate(q.valid_until, l)}</span></span><span className="tabular font-medium">{fmtSAR(q.total, l)}</span></li>) : <li className="text-muted">{t("app.none")}</li>}</ul>
        </Card>
        <Card title={t("client.invoices")}>
          <ul className="grid gap-2 text-sm">{o.invoices.map((i) => <li key={i.ref} className="flex justify-between gap-2"><span><Mono>{i.ref}</Mono> <Pill tone={statusTone(i.status)}>{t(`status.${i.status}`)}</Pill></span><span className="tabular font-medium">{fmtSAR(i.total, l)}</span></li>)}</ul>
        </Card>
      </div>
    </>
  );
}
