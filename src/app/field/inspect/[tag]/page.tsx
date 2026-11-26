import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { InspectForm } from "@/components/field/inspect-form";
import { Mono, TagPill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { fmtDate, L, type Loc } from "@/lib/format";
import { TAG_ROLES } from "@/lib/checklist";

export default async function Inspect({ params }: { params: Promise<{ tag: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const tag = decodeURIComponent((await params).tag).toUpperCase();
  if (!/^[A-Z]{3}-\d{4}$/.test(tag)) notFound();
  const d = await withUser(s, async (db) => {
    const sc = await one<{ id: string; tag_no: string; status: string; type: string; location_desc: string | null; restrictions: string | null; load_class: string | null; height_m: string; length_m: string; width_m: string; site_code: string; site_name: string; site_name_ar: string | null; access: string | null; last_inspected_at: string | null }>(db,
      `select sc.*, si.code site_code, si.name site_name, si.name_ar site_name_ar, si.access_requirements access from scaffolds sc join sites si on si.id = sc.site_id where sc.tag_no = $1`, [tag]);
    if (!sc) return null;
    const defects = await rows<{ code: string; description: string; severity: string }>(db, "select code, description, severity from defects where scaffold_id = $1 and status = 'open' order by created_at desc", [sc.id]);
    return { sc, defects };
  });
  if (!d) notFound();
  const { sc } = d;
  return (
    <>
      <header className="sticky top-0 z-10 bg-ink px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <Link href="/field" className="text-xs text-white/60">← {t("field.back")}</Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <h1 className="font-mono text-xl font-semibold">{sc.tag_no}</h1>
          <TagPill status={sc.status} label={t(`tag.${sc.status}`)} />
        </div>
        <p className="text-sm text-white/80">{sc.location_desc}</p>
        <p className="text-xs text-white/50"><Mono>{sc.site_code}</Mono> · {L(sc, "site_name", l)} · {t(`types.${sc.type}`)} · {sc.load_class}</p>
        <p className="mt-1 text-xs text-white/50" dir="ltr">{Number(sc.length_m)} × {Number(sc.width_m)} × {Number(sc.height_m)} m · {t("field.last")}: {fmtDate(sc.last_inspected_at, l)}</p>
      </header>
      {(sc.restrictions || d.defects.length > 0) && (
        <div className="mx-4 mt-4 rounded-xl bg-tag-yellow-bg p-3 text-sm text-tag-yellow">
          {sc.restrictions && <p>{sc.restrictions}</p>}
          {d.defects.length > 0 && <><p className="mt-1 font-semibold">{t("field.defects")}</p><ul className="list-disc ps-5">{d.defects.map((x, i) => <li key={i}>{x.code}: {x.description}</li>)}</ul></>}
        </div>
      )}
      <InspectForm tagNo={sc.tag_no} currentStatus={sc.status} role={s.role} canFull={(TAG_ROLES.full as readonly string[]).includes(s.role)} />
    </>
  );
}
