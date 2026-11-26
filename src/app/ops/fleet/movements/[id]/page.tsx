import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Confidence, Flash, Mono, PageHeader, Pill, statusTone, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { fmtDate, fmtNum, type Loc } from "@/lib/format";
import { completeMovementAction } from "@/lib/actions/fleet";

export default async function Movement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const { id } = await params;
  const { msg } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withUser(s, async (db) => {
    const m = await one<{ ref: string; kind: string; status: string; delivery_note_no: string | null; scheduled_for: string | null; completed_at: string | null; site_code: string | null; from_name: string | null; to_name: string | null; plate: string | null; ai_extracted: { unmatched?: string[]; confidence?: number; signed_by_receiver?: boolean; mode?: string } | null }>(db,
      `select m.*, si.code site_code, lf.name from_name, lt.name to_name, v.plate from movements m left join sites si on si.id = m.site_id
       left join locations lf on lf.id = m.from_location_id left join locations lt on lt.id = m.to_location_id left join vehicles v on v.id = m.vehicle_id where m.id = $1`, [id]);
    if (!m) return null;
    const lines = await rows<{ sku: string; name: string; qty: string; kg: string }>(db, "select i.sku, i.name, ml.qty, ml.qty * i.weight_kg kg from movement_lines ml join items i on i.id = ml.item_id where ml.movement_id = $1 order by i.sku", [id]);
    return { m, lines };
  });
  if (!d) notFound();
  const { m } = d;
  const open = ["planned", "in_transit"].includes(m.status);
  const ai = m.ai_extracted;
  return (
    <>
      <Link href="/ops/fleet" className="text-sm text-muted hover:text-ink">← Fleet & logistics</Link>
      <PageHeader title={`${m.ref} · ${t(`types.${m.kind}`)}`} sub={`${m.from_name ?? "—"} → ${m.to_name ?? "—"}${m.delivery_note_no ? ` · ${m.delivery_note_no}` : ""}`} actions={<Pill tone={statusTone(m.status)}>{t(`status.${m.status}`)}</Pill>} />
      <Flash msg={msg} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title={`Lines · ${fmtNum(d.lines.reduce((a, x) => a + Number(x.kg), 0) / 1000, l, 1)} t`}>
          <Table minWidth={420} head={["Item", t("cols.qty"), "kg"]}>
            {d.lines.map((x) => (
              <tr key={x.sku}><Td><Mono>{x.sku}</Mono> <span className="text-muted">{x.name}</span></Td><Td className="tabular">{fmtNum(x.qty, l)}</Td><Td className="tabular text-muted">{fmtNum(x.kg, l)}</Td></tr>
            ))}
          </Table>
          {!!ai?.unmatched?.length && <p className="mt-3 rounded-lg bg-tag-yellow-bg p-3 text-sm text-tag-yellow">Not recognised on the note: {ai.unmatched.join("; ")}. Add them manually if they were on the truck.</p>}
        </Card>
        <div className="grid content-start gap-4">
          <Card title="Movement">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted">{t("cols.site")}</dt><dd><Mono>{m.site_code ?? "—"}</Mono></dd></div>
              <div><dt className="text-xs text-muted">{t("cols.vehicle")}</dt><dd>{m.plate ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted">{t("cols.when")}</dt><dd>{fmtDate(m.scheduled_for, l)}</dd></div>
              <div><dt className="text-xs text-muted">Completed</dt><dd>{fmtDate(m.completed_at, l)}</dd></div>
            </dl>
            {ai && (
              <div className="mt-4 rounded-lg bg-canvas p-3 text-sm">
                <div className="flex items-center justify-between"><span className="font-medium">Read by the Fleet agent{ai.mode === "mock" ? " (mock)" : ""}</span><Confidence value={ai.confidence ?? null} /></div>
                <p className="mt-1 text-xs text-muted">{ai.signed_by_receiver ? "Receiver's signature found." : "No receiver's signature found: get the signed copy."}</p>
              </div>
            )}
            {open && (
              <form action={completeMovementAction} className="mt-4">
                <input type="hidden" name="id" value={id} />
                <p className="mb-2 text-xs text-muted">{m.kind === "delivery" ? "Completing takes the material out of the yard and puts it on hire at the site from today." : m.kind === "return" ? "Completing puts the material back in the yard and closes the on-hire lines, so billing stops." : "Completing moves the stock between yards."}</p>
                <SubmitButton className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white" pending="Completing…">Confirm and complete</SubmitButton>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
