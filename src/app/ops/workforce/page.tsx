import { getLocale, getTranslations } from "next-intl/server";
import { Card, DueLabel, Mono, PageHeader, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { daysUntil, fmtDate, L, type Loc } from "@/lib/format";
import { crewBySite, expiries } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const [exp, crews] = await Promise.all([expiries(s, 45), crewBySite(s)]);
  const dt = (key: string, v?: Record<string, number>) => t(`dash.${key}`, v);
  return (
    <>
      <PageHeader title={t("nav.workforce")} sub={t("pages.workforceSub")} />
      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Card title={t("dash.bySite")}>
          <Table head={[t("cols.site"), t("trades.scaffolder"), t("trades.scaffold_supervisor"), t("trades.scaffold_inspector"), "Other"]}>
            {crews.map((c) => (
              <tr key={c.code}>
                <Td><Mono>{c.code}</Mono><div className="text-xs text-muted">{L(c, "name", l)}</div></Td>
                <Td className="tabular">{c.scaffolders}</Td>
                <Td className="tabular">{c.supervisors}</Td>
                <Td className="tabular">{c.inspectors}</Td>
                <Td className="tabular">{c.other}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={t("kpi.expiringCerts")}>
          <Table head={[t("cols.worker"), t("cols.trade"), t("cols.cert"), t("cols.site"), t("cols.expires"), ""]}>
            {exp.map((x, i) => (
              <tr key={i}>
                <Td><div className="font-medium">{x.full_name}</div><div className="text-xs text-muted"><Mono>{x.employee_no}</Mono></div></Td>
                <Td className="whitespace-nowrap">{t(`trades.${x.trade}`)}</Td>
                <Td className="whitespace-nowrap">{t(`certs.${x.kind}`)}</Td>
                <Td><Mono>{x.site_code ?? "—"}</Mono></Td>
                <Td className="whitespace-nowrap text-muted">{fmtDate(x.expires_on, l)}</Td>
                <Td className="whitespace-nowrap text-xs"><DueLabel days={daysUntil(x.expires_on)} t={dt} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
