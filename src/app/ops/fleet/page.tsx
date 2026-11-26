import { getLocale, getTranslations } from "next-intl/server";
import { Card, Mono, PageHeader, Pill, statusTone, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { daysUntil, fmtDate, fmtNum, fmtSAR, L, type Loc } from "@/lib/format";
import { movementsUpcoming, onHireBySite, stockByYard } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const [stock, hire, moves] = await Promise.all([stockByYard(s), onHireBySite(s), movementsUpcoming(s)]);
  return (
    <>
      <PageHeader title={t("nav.fleet")} sub={t("pages.fleetSub")} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`${t("cols.yard")} · ${t("cols.onHire")}`}>
          <Table head={[t("cols.item"), "Dammam", "Jubail", t("cols.onHire"), "Utilisation"]}>
            {stock.map((x) => {
              const total = Number(x.dammam) + Number(x.jubail) + Number(x.on_hire);
              const util = total ? Number(x.on_hire) / total : 0;
              const low = Number(x.jubail) < 300 && ["board", "fitting"].includes(x.category);
              return (
                <tr key={x.sku}>
                  <Td><Mono>{x.sku}</Mono><div className="text-xs text-muted">{L(x, "name", l)}</div></Td>
                  <Td className="tabular">{fmtNum(x.dammam, l)}</Td>
                  <Td className="tabular">{fmtNum(x.jubail, l)} {low && <Pill tone="yellow">low</Pill>}</Td>
                  <Td className="tabular">{fmtNum(x.on_hire, l)}</Td>
                  <Td className="w-32">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line"><div className="h-full bg-brand" style={{ width: `${Math.round(util * 100)}%` }} /></div>
                    <div className="mt-0.5 text-[11px] text-muted tabular">{Math.round(util * 100)}%</div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
        <div className="grid content-start gap-4">
          <Card title={t("cols.onHire")}>
            <Table head={[t("cols.site"), t("cols.item"), t("cols.qty"), t("cols.rateDay"), t("cols.since"), t("cols.status")]}>
              {hire.map((x) => (
                <tr key={x.id}>
                  <Td><Mono>{x.site_code}</Mono></Td>
                  <Td>{L(x, "item", l)}</Td>
                  <Td className="tabular">{fmtNum(x.qty, l)}</Td>
                  <Td className="tabular whitespace-nowrap">{fmtSAR(Number(x.qty) * Number(x.rate_day), l)}</Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDate(x.start_date, l)}</Td>
                  <Td>
                    <Pill tone={statusTone(x.status)}>{t(`status.${x.status}`)}</Pill>
                    {x.off_hire_requested_at && <div className="mt-1 text-[11px] font-semibold text-tag-red">{-1 * (daysUntil(x.off_hire_requested_at) ?? 0)} d not collected</div>}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Movements">
            <Table head={[t("cols.ref"), t("cols.kind"), t("cols.site"), t("cols.when"), t("cols.vehicle"), t("cols.status")]}>
              {moves.map((m) => (
                <tr key={m.ref}>
                  <Td><Mono>{m.ref}</Mono>{m.dn && <div className="text-[11px] text-muted">{m.dn}</div>}</Td>
                  <Td>{t(`types.${m.kind}`)}</Td>
                  <Td><Mono>{m.site_code ?? "—"}</Mono></Td>
                  <Td className="whitespace-nowrap">{fmtDate(m.scheduled_for, l)}</Td>
                  <Td className="whitespace-nowrap text-xs">{m.plate}<div className="text-muted">{m.driver}</div></Td>
                  <Td><Pill tone={statusTone(m.status)}>{t(`status.${m.status}`)}</Pill></Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
