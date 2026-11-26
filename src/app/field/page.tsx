import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DueLabel, Mono, TagPill } from "@/components/ui";
import { Icon } from "@/components/nav-links";
import { requireSession } from "@/lib/auth";
import { OutboxSync } from "@/components/field/outbox-sync";
import { daysUntil, L, type Loc } from "@/lib/format";
import { inspectionRound } from "@/lib/queries";

export default async function Field() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const list = await inspectionRound(s);
  const dt = (key: string, v?: Record<string, number>) => t(`dash.${key}`, v);
  const bySite = Object.groupBy(list, (x) => x.site_code);
  return (
    <div>
      <header className="sticky top-0 z-10 bg-ink px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-center justify-between">
          <Link href="/ops" className="text-xs text-white/60">← OneSite</Link>
          <OutboxSync />
        </div>
        <h1 className="mt-3 text-xl font-semibold">{t("field.title")}</h1>
        <p className="text-xs text-white/60">{t("field.sub")}</p>
        <Link href="/field/scan" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 font-semibold"><Icon name="qr" /> {t("field.scan")}</Link>
      </header>
      <div className="grid gap-5 p-4">
        {Object.entries(bySite).map(([code, items]) => (
          <section key={code}>
            <h2 className="eyebrow mb-2"><Mono>{code}</Mono> · {L(items![0], "site_name", l)}</h2>
            <ul className="grid gap-2">
              {items!.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><Mono>{x.tag_no}</Mono><TagPill status={x.status} label={t(`tag.${x.status}`)} /></div>
                    <div className="mt-0.5 truncate text-sm">{x.location_desc}</div>
                    <div className="text-xs">{x.status === "red" ? <span className="font-semibold text-tag-red">{t("tagHelp.red")}</span> : <DueLabel days={daysUntil(x.next_inspection_due)} t={dt} />}</div>
                  </div>
                  <Link href={`/field/inspect/${x.tag_no}`} className="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white">{t("field.inspect")}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
