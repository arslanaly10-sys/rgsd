import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import type { Session } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { daysUntil, fmtDate, L, type Loc } from "@/lib/format";
import { Card, DueLabel, Mono, Pill, TagPill } from "./ui";

type Insp = { id: string; type: string; result: string; ai_suggested_result: string | null; restrictions: string | null; notes: string | null; inspected_at: string; inspector: string | null; checklist: { code: string; label?: string; result: string; note?: string }[]; ai_findings: { code: string; description: string; severity: string; confidence: number }[] | null };

export async function loadScaffold(s: Session, tag: string) {
  return withUser(s, async (db) => {
    const sc = await one<{ id: string; tag_no: string; qr_code: string; status: string; type: string; location_desc: string | null; restrictions: string | null; load_class: string | null; duty: string | null; height_m: string; length_m: string; width_m: string; volume_m3: string; erected_at: string | null; last_inspected_at: string | null; next_inspection_due: string | null; site_code: string; site_name: string; site_name_ar: string | null; job_ref: string | null }>(db,
      `select sc.*, si.code site_code, si.name site_name, si.name_ar site_name_ar, j.ref job_ref from scaffolds sc join sites si on si.id = sc.site_id left join jobs j on j.id = sc.job_id where sc.tag_no = $1`, [tag]);
    if (!sc) return null;
    const inspections = await rows<Insp>(db, `select i.id, i.type, i.result, i.ai_suggested_result, i.restrictions, i.notes, i.inspected_at, i.checklist, i.ai_findings, p.full_name inspector
      from inspections i left join profiles p on p.id = i.inspector_id where i.scaffold_id = $1 order by i.inspected_at desc limit 20`, [sc.id]);
    const photos = await rows<{ id: string; entity_id: string; title: string }>(db, "select id, entity_id, title from documents where entity_type = 'inspection' and entity_id = any($1) order by created_at", [inspections.map((i) => i.id)]);
    const defects = await rows<{ code: string; description: string; severity: string; status: string; created_at: string }>(db, "select code, description, severity, status, created_at from defects where scaffold_id = $1 order by (status = 'open') desc, created_at desc limit 20", [sc.id]);
    return { sc, inspections, photos, defects };
  });
}

export async function ScaffoldDetail({ data, staff }: { data: NonNullable<Awaited<ReturnType<typeof loadScaffold>>>; staff: boolean }) {
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const { sc } = data;
  const qr = await QRCode.toString(sc.qr_code, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const dt = (key: string, v?: Record<string, number>) => t(`dash.${key}`, v);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="grid content-start gap-4">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <TagPill status={sc.status} label={t(`tag.${sc.status}`)} />
              {sc.restrictions && <p className="mt-2 text-sm font-medium text-tag-yellow">{sc.restrictions}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted">{t("cols.site")}</dt><dd><Mono>{sc.site_code}</Mono> {L(sc, "site_name", l)}</dd></div>
                <div><dt className="text-xs text-muted">{t("cols.location")}</dt><dd>{sc.location_desc}</dd></div>
                <div><dt className="text-xs text-muted">{t("cols.type")}</dt><dd>{t(`types.${sc.type}`)}</dd></div>
                <div><dt className="text-xs text-muted">{t("cols.loadClass")}</dt><dd>{sc.load_class} {sc.duty ? `· ${sc.duty}` : ""}</dd></div>
                <div><dt className="text-xs text-muted">{t("cols.size")}</dt><dd dir="ltr" className="text-start">{Number(sc.length_m)} × {Number(sc.width_m)} × {Number(sc.height_m)} m · {Number(sc.volume_m3)} m³</dd></div>
                <div><dt className="text-xs text-muted">{t("cols.nextDue")}</dt><dd>{["green", "yellow"].includes(sc.status) ? <DueLabel days={daysUntil(sc.next_inspection_due)} t={dt} /> : "—"}</dd></div>
              </dl>
            </div>
            <div className="w-24 shrink-0 text-center">
              <div className="aspect-square w-24 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
              {staff && <Link href={`/tags/${sc.tag_no}`} className="mt-1 block text-[11px] font-semibold text-brand">Print tag</Link>}
            </div>
          </div>
          {staff && <Link href={`/field/inspect/${sc.tag_no}`} className="mt-4 block rounded-lg bg-brand py-2.5 text-center text-sm font-semibold text-white">Inspect now</Link>}
        </Card>
        <Card title="Defects">
          {data.defects.length ? (
            <ul className="grid gap-2 text-sm">
              {data.defects.map((d, i) => (
                <li key={i} className="flex items-start justify-between gap-2">
                  <span><span className="font-mono text-[11px] text-muted">{d.code}</span> {d.description}</span>
                  <span className="flex shrink-0 gap-1"><Pill tone={d.severity === "critical" || d.severity === "high" ? "red" : "yellow"}>{d.severity}</Pill><Pill tone={d.status === "open" ? "red" : "green"}>{d.status}</Pill></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No defects recorded.</p>}
        </Card>
      </div>
      <Card title={`Inspection history (${data.inspections.length})`}>
        <ol className="relative grid gap-5 border-s-2 border-line ps-5">
          {data.inspections.map((i) => {
            const pics = data.photos.filter((p) => p.entity_id === i.id);
            const fails = (i.checklist ?? []).filter((c) => c.result === "fail");
            return (
              <li key={i.id} className="relative">
                <span className={`absolute -start-[27px] top-1 size-3 rounded-full ring-4 ring-panel ${i.result === "green" ? "bg-tag-green" : i.result === "yellow" ? "bg-[#e0a300]" : "bg-tag-red"}`} aria-hidden />
                <div className="flex flex-wrap items-center gap-2">
                  <TagPill status={i.result} label={t(`tag.${i.result}`)} />
                  <span className="text-sm font-medium">{t(`field.types.${i.type}`)}</span>
                  <span className="text-xs text-muted">{fmtDate(i.inspected_at, l)} · {i.inspector ?? "—"}</span>
                  {i.ai_suggested_result && i.ai_suggested_result !== i.result && <Pill tone="yellow">AI suggested {i.ai_suggested_result}</Pill>}
                </div>
                {i.restrictions && <p className="mt-1 text-sm text-tag-yellow">{i.restrictions}</p>}
                {fails.length > 0 && <ul className="mt-1 text-sm">{fails.map((c) => <li key={c.code}>✕ <span className="font-mono text-[11px]">{c.code}</span> {c.note || c.label}</li>)}</ul>}
                {!!i.ai_findings?.length && <ul className="mt-1 text-xs text-muted">{i.ai_findings.map((f, k) => <li key={k}>✦ AI: {f.description} ({f.severity}, {Math.round(f.confidence * 100)}%)</li>)}</ul>}
                {i.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{i.notes}</p>}
                {pics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pics.map((p) => (
                      <a key={p.id} href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-lg border border-line">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${p.id}`} alt={p.title} className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
