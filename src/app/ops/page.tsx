import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, DueLabel, Kpi, Mono, PageHeader, Pill, TagPill } from "@/components/ui";
import { TagBar } from "@/components/tag-bar";
import { requireSession } from "@/lib/auth";
import { daysUntil, fmtNum, fmtSAR, L, type Loc } from "@/lib/format";
import { expiries, inspectionRound, navBadges, opsKpis, recentAgentRuns, siteSummaries } from "@/lib/queries";

export default async function OpsHome() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const [k, sites, due, exp, runs, badges] = await Promise.all([opsKpis(s), siteSummaries(s), inspectionRound(s), expiries(s, 30), recentAgentRuns(s), navBadges(s)]);
  const name = l === "ar" && s.fullNameAr ? s.fullNameAr : s.fullName;
  const dt = (key: string, v?: Record<string, number>) => t(`dash.${key}`, v);

  return (
    <>
      <PageHeader title={t("client.welcome", { name: name.split(" ")[0] })} sub={t("app.tagline")} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("kpi.dueInspection")} value={fmtNum(k!.due, l)} tone={k!.due ? "red" : "default"} href="/ops/scaffolds?due=1" hint={`${fmtNum(k!.standing, l)} ${t("kpi.scaffoldsUp").toLowerCase()}`} />
        <Kpi label={t("kpi.redTags")} value={fmtNum(k!.red, l)} tone={k!.red ? "red" : "default"} href="/ops/scaffolds?status=red" hint={`${fmtNum(k!.yellow, l)} ${t("tag.yellow").toLowerCase()}`} />
        <Kpi label={t("kpi.onHireDay")} value={fmtSAR(k!.onhire_day, l)} tone="brand" href="/ops/fleet" hint={`${t("kpi.unbilled")}: ${fmtSAR(k!.unbilled, l)}`} />
        <Kpi label={t("kpi.expiringCerts")} value={fmtNum(k!.expiring, l)} tone={k!.expiring ? "yellow" : "default"} href="/ops/workforce" hint={`${t("kpi.openRequests")}: ${fmtNum(k!.open_requests, l)} · ${t("kpi.pendingApprovals")}: ${fmtNum(badges.approvals, l)}`} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card title={t("dash.tagMix")} action={<Link className="text-xs font-semibold text-brand" href="/ops/sites">{t("app.viewAll")}</Link>}>
          <ul className="flex flex-col divide-y divide-line">
            {sites.map((x) => (
              <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Mono>{x.code}</Mono>
                    <span className="truncate text-sm font-medium">{L(x, "name", l)}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{L(x, "client", l)} · {t(`types.${x.type}`)}</div>
                </div>
                <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <TagBar green={x.green} yellow={x.yellow} red={x.red} labels={{ green: t("tag.green"), yellow: t("tag.yellow"), red: t("tag.red") }} />
                  <div className="mt-1 flex gap-3 text-[11px] text-muted tabular">
                    <span>{x.green} {t("tag.green")}</span><span>{x.yellow} Y</span><span className={x.red ? "font-semibold text-tag-red" : ""}>{x.red} R</span>
                  </div>
                </div>
                <div className="text-end text-xs tabular">
                  {x.due > 0 ? <Pill tone="red">{x.due} {t("cols.due")}</Pill> : <Pill tone="green">OK</Pill>}
                  <div className="mt-1 text-muted">{fmtSAR(x.onhire_day, l)}/d</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("dash.attention")}>
          <ul className="flex flex-col gap-2.5">
            {due.slice(0, 6).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Mono>{x.tag_no}</Mono><TagPill status={x.status} label={t(`tag.${x.status}`)} /></div>
                  <div className="truncate text-xs text-muted">{x.location_desc}</div>
                </div>
                <div className="shrink-0 text-xs"><DueLabel days={daysUntil(x.next_inspection_due)} t={dt} /></div>
              </li>
            ))}
            {exp.slice(0, 4).map((x, i) => (
              <li key={`e${i}`} className="flex items-center justify-between gap-3 border-t border-line pt-2.5 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{x.full_name} <span className="text-xs font-normal text-muted">· {t(`trades.${x.trade}`)}</span></div>
                  <div className="text-xs text-muted">{t(`certs.${x.kind}`)}{x.site_code ? ` · ${x.site_code}` : ""}</div>
                </div>
                <div className="shrink-0 text-xs"><DueLabel days={daysUntil(x.expires_on)} t={dt} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4">
        <Card title={t("dash.agentsFeed")} action={<Link className="text-xs font-semibold text-brand" href="/ops/agents">{t("nav.agents")}</Link>}>
          {runs.length === 0 ? (
            <p className="text-sm text-muted">{t("dash.noAgents")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate"><Pill tone="dark">{r.agent}</Pill> <span className="ms-2">{r.summary}</span></span>
                  <Pill tone={r.status === "completed" ? "green" : r.status === "failed" ? "red" : "yellow"}>{r.status}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
