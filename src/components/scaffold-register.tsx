import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { daysUntil, fmtDate, fmtNum, L, type Loc } from "@/lib/format";
import { scaffolds, siteOptions } from "@/lib/queries";
import { Card, DueLabel, Mono, Pill, TagPill, Table, Td } from "./ui";

export async function ScaffoldRegister({ session, searchParams, basePath }: { session: Session; searchParams: Record<string, string | undefined>; basePath: string }) {
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const f = { site: searchParams.site, status: searchParams.status, due: searchParams.due === "1", q: searchParams.q };
  const [list, opts] = await Promise.all([scaffolds(session, f), siteOptions(session)]);
  const dt = (key: string, v?: Record<string, number>) => t(`dash.${key}`, v);
  const counts = { green: 0, yellow: 0, red: 0 } as Record<string, number>;
  list.forEach((x) => (counts[x.status] = (counts[x.status] ?? 0) + 1));

  const field = "rounded-lg border border-line bg-panel px-3 py-2 text-sm";
  return (
    <Card>
      <form method="get" action={basePath} className="mb-4 flex flex-wrap items-center gap-2">
        <input id="q" name="q" defaultValue={f.q} placeholder={`${t("app.search")}: ${t("cols.tag")} / ${t("cols.location")}`} className={`${field} min-w-0 flex-1 sm:max-w-xs`} />
        <select id="site" name="site" defaultValue={f.site ?? ""} className={field}>
          <option value="">{t("filters.allSites")}</option>
          {opts.map((o) => <option key={o.code} value={o.code}>{o.code} · {L(o, "name", l)}</option>)}
        </select>
        <select id="status" name="status" defaultValue={f.status ?? ""} className={field}>
          <option value="">{t("filters.allStatus")}</option>
          {["green", "yellow", "red", "erecting", "dismantled"].map((x) => <option key={x} value={x}>{t(`tag.${x}`)}</option>)}
        </select>
        <label className="flex items-center gap-2 px-1 text-sm">
          <input id="due" type="checkbox" name="due" value="1" defaultChecked={f.due} className="accent-brand" /> {t("filters.dueOnly")}
        </label>
        <button className="rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white">{t("filters.apply")}</button>
        <span className="ms-auto flex gap-2 text-xs tabular">
          <TagPill status="green" label={`${counts.green ?? 0}`} /><TagPill status="yellow" label={`${counts.yellow ?? 0}`} /><TagPill status="red" label={`${counts.red ?? 0}`} />
        </span>
      </form>
      <Table head={[t("cols.tag"), t("cols.status"), t("cols.site"), t("cols.location"), t("cols.type"), t("cols.size"), t("cols.loadClass"), t("cols.lastInspected"), t("cols.nextDue")]} empty={list.length ? undefined : t("app.none")}>
        {list.map((x) => (
          <tr key={x.id} className="hover:bg-canvas/60">
            <Td><Link href={`${basePath}/${x.tag_no}`} className="hover:text-brand"><Mono>{x.tag_no}</Mono></Link>{x.open_defects > 0 && <span className="ms-2"><Pill tone="red">{x.open_defects} ⚠</Pill></span>}</Td>
            <Td>
              <TagPill status={x.status} label={t(`tag.${x.status}`)} />
              {x.restrictions && <div className="mt-1 max-w-[220px] text-xs text-tag-yellow">{x.restrictions}</div>}
            </Td>
            <Td><span title={L(x, "site_name", l)}><Mono>{x.site_code}</Mono></span></Td>
            <Td className="max-w-[200px]">{x.location_desc}</Td>
            <Td className="whitespace-nowrap">{t(`types.${x.type}`)}</Td>
            <Td className="whitespace-nowrap tabular text-muted" ><span dir="ltr">{fmtNum(x.length_m, l, 1)} × {fmtNum(x.width_m, l, 1)} × {fmtNum(x.height_m, l, 1)} m</span><div className="text-xs" dir="ltr">{fmtNum(x.volume_m3, l)} m³</div></Td>
            <Td className="whitespace-nowrap text-xs text-muted">{x.load_class}</Td>
            <Td className="whitespace-nowrap text-muted">{fmtDate(x.last_inspected_at, l)}</Td>
            <Td className="whitespace-nowrap">
              {["green", "yellow"].includes(x.status) ? <DueLabel days={daysUntil(x.next_inspection_due)} t={dt} /> : <span className="text-muted">—</span>}
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
