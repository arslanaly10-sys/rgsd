import { getLocale, getTranslations } from "next-intl/server";
import { Card, Mono, PageHeader, Pill } from "@/components/ui";
import { TagBar } from "@/components/tag-bar";
import { requireSession } from "@/lib/auth";
import { fmtSAR, L, type Loc } from "@/lib/format";
import { siteSummaries } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const sites = await siteSummaries(s);
  return (
    <>
      <PageHeader title={t("nav.sites")} sub={t("pages.sitesSub")} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sites.map((x) => (
          <Card key={x.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Mono>{x.code}</Mono>
                <h2 className="mt-1 text-base font-semibold leading-snug">{L(x, "name", l)}</h2>
                <p className="text-xs text-muted">{L(x, "client", l)}</p>
              </div>
              <Pill>{t(`types.${x.type}`)}</Pill>
            </div>
            <div className="mt-4"><TagBar green={x.green} yellow={x.yellow} red={x.red} /></div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted">{t("cols.due")}</dt><dd className={`tabular text-base font-semibold ${x.due ? "text-tag-red" : ""}`}>{x.due}</dd></div>
              <div><dt className="text-muted">{t("cols.onHire")}</dt><dd className="tabular text-base font-semibold">{fmtSAR(x.onhire_day, l)}</dd></div>
              <div><dt className="text-muted">Crew</dt><dd className="tabular text-base font-semibold">{x.crew}</dd></div>
            </dl>
          </Card>
        ))}
      </div>
    </>
  );
}
