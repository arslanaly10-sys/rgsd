import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink, Card, Confidence, Flash, Mono, PageHeader, Pill, statusTone, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { fmtDate, fmtNum, fmtSAR, L, type Loc } from "@/lib/format";
import type { Scope, Takeoff } from "@/lib/estimating";
import { saveQuoteLines, submitQuote } from "@/lib/actions/quotes";

export default async function QuoteEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const { id } = await params;
  const { msg } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withUser(s, async (db) => {
    const q = await one<{ id: string; ref: string; status: string; kind: string; subtotal: string; vat: string; total: string; valid_until: string | null; assumptions: string | null; ai_generated: boolean; ai_confidence: string | null; scope: Scope | null; takeoff: Takeoff | null; questions: string[]; client: string; client_ar: string | null; request_id: string | null; request_ref: string | null; client_decision_note: string | null; preparer: string | null }>(db,
      `select q.*, c.name client, c.name_ar client_ar, r.ref request_ref, p.full_name preparer from quotes q join client_companies c on c.id = q.client_company_id
       left join requests r on r.id = q.request_id left join profiles p on p.id = q.prepared_by where q.id = $1`, [id]);
    if (!q) return null;
    const lines = await rows<{ id: string; description: string; description_ar: string | null; qty: string; unit: string; rate: string; amount: string }>(db, "select id, description, description_ar, qty, unit, rate, amount from quote_lines where quote_id=$1 order by sort", [id]);
    const approval = await one<{ status: string }>(db, "select status from approval_requests where tool='send_quote' and payload->'input'->>'quote_ref' = $1 order by created_at desc limit 1", [q.ref]);
    return { q, lines, approval };
  });
  if (!d) notFound();
  const { q } = d;
  const editable = ["draft", "pending_approval"].includes(q.status) && ["admin", "ops_manager", "estimator"].includes(s.role);
  const field = "w-full rounded-md border border-line bg-panel px-2 py-1 text-sm tabular";
  return (
    <>
      {q.request_id && <Link href={`/ops/requests/${q.request_id}`} className="text-sm text-muted hover:text-ink">← {q.request_ref}</Link>}
      <PageHeader
        title={`${q.ref} · ${L(q, "client", l)}`}
        sub={`${q.ai_generated ? "Drafted by the AI Estimator" : "Prepared"}${q.preparer ? ` for ${q.preparer}` : ""} · ${t("cols.valid")} ${fmtDate(q.valid_until, l)}`}
        actions={<><Pill tone={statusTone(q.status)}>{t(`status.${q.status}`)}</Pill><ButtonLink href={`/q/${q.id}`} variant="ghost">Quote document (EN/AR)</ButtonLink></>}
      />
      <Flash msg={msg} />
      {q.client_decision_note && <div className="mb-4 rounded-lg bg-canvas px-4 py-3 text-sm">Client note: “{q.client_decision_note}”</div>}

      <div className="grid gap-4 xl:grid-cols-[1.75fr_1fr]">
        <form action={saveQuoteLines} className="grid content-start gap-4">
          <input type="hidden" name="quoteId" value={q.id} />
          <Card title="Priced lines" action={<span className="text-xs text-muted">Rates are SAMPLE values</span>}>
            <Table minWidth={editable ? 720 : 560} head={["Description", t("cols.qty"), "Unit", "Rate", "Amount", ...(editable ? ["Remove"] : [])]}>
              {d.lines.map((x) => (
                <tr key={x.id}>
                  <Td className="min-w-[220px]">{editable ? <input id={`desc_${x.id}`} name={`desc_${x.id}`} defaultValue={x.description} className={field} /> : x.description}<div className="mt-0.5 text-xs text-muted" dir="rtl">{x.description_ar}</div></Td>
                  <Td>{editable ? <input id={`qty_${x.id}`} name={`qty_${x.id}`} type="number" step="0.01" min="0" defaultValue={Number(x.qty)} className={`${field} w-24`} /> : fmtNum(x.qty, l, 2)}</Td>
                  <Td className="text-xs text-muted">{x.unit}</Td>
                  <Td>{editable ? <input id={`rate_${x.id}`} name={`rate_${x.id}`} type="number" step="0.01" min="0" defaultValue={Number(x.rate)} className={`${field} w-24`} /> : fmtNum(x.rate, l, 2)}</Td>
                  <Td className="whitespace-nowrap text-end tabular font-medium">{fmtSAR(x.amount, l, 2)}</Td>
                  {editable && <Td><input type="checkbox" name={`remove_${x.id}`} aria-label={`Remove ${x.description}`} className="accent-tag-red" /></Td>}
                </tr>
              ))}
            </Table>
            <dl className="mt-4 ms-auto grid w-full max-w-xs gap-1 text-sm tabular">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{fmtSAR(q.subtotal, l, 2)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">VAT 15%</dt><dd>{fmtSAR(q.vat, l, 2)}</dd></div>
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><dt>{t("cols.total")}</dt><dd>{fmtSAR(q.total, l, 2)}</dd></div>
            </dl>
          </Card>
          <Card title="Assumptions & exclusions">
            {editable ? <textarea id="assumptions" name="assumptions" rows={6} defaultValue={q.assumptions ?? ""} className="w-full rounded-lg border border-line p-3 text-sm" /> : <p className="whitespace-pre-wrap text-sm">{q.assumptions}</p>}
            {editable && (
              <>
                <label htmlFor="lesson" className="mt-3 block text-xs font-medium text-muted">What should the Estimator learn from your edits? (optional)</label>
                <input id="lesson" name="lesson" placeholder="e.g. Offshore cantilevers need 2 design calcs, one per lift" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <SubmitButton className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-semibold hover:bg-canvas" pending="Saving…">Save changes</SubmitButton>
                </div>
              </>
            )}
          </Card>
        </form>

        <div className="grid content-start gap-4">
          <Card title="Send to client">
            {q.status === "draft" ? (
              <form action={submitQuote}>
                <input type="hidden" name="quoteId" value={q.id} />
                <p className="text-sm text-muted">Sending a quote is a tier 3 action: an operations manager approves it first, then it appears in the client&apos;s portal and is emailed.</p>
                <SubmitButton className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600" pending="Submitting…">Submit for approval</SubmitButton>
              </form>
            ) : (
              <p className="text-sm">Status: <strong>{t(`status.${q.status}`)}</strong>{d.approval ? ` · approval ${d.approval.status}` : ""}. {q.status === "pending_approval" && <Link className="text-brand" href="/ops/approvals">Open approvals →</Link>}</p>
            )}
          </Card>
          {q.scope && (
            <Card title="Extracted scope" action={<Confidence value={q.ai_confidence} />}>
              <ul className="grid gap-2 text-sm">
                {q.scope.items.map((it, i) => (
                  <li key={i} className="rounded-lg bg-canvas px-3 py-2">
                    <div className="font-medium">{it.quantity > 1 ? `${it.quantity} × ` : ""}{it.description}</div>
                    <div className="text-xs text-muted" dir="ltr">{t(`types.${it.scaffold_type}`)} · {it.length_m} × {it.width_m} × {it.height_m} m · {it.duty}{it.complex ? " · complex" : ""}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">{q.scope.hire_weeks} weeks hire{q.scope.offshore ? " · offshore" : ""}{q.scope.night_work ? " · night work" : ""}</p>
              {!!q.questions.length && (
                <div className="mt-3 rounded-lg bg-tag-yellow-bg p-3 text-sm text-tag-yellow">
                  <p className="font-semibold">Questions for the client</p>
                  <ul className="mt-1 list-disc ps-5">{q.questions.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
            </Card>
          )}
          {q.takeoff && (
            <Card title={`Material take-off · ${fmtNum(q.takeoff.total_weight_kg / 1000, l, 1)} t · ${q.takeoff.truck_trips} truck trip(s)`}>
              <Table minWidth={340} head={["Item", t("cols.qty"), "Yard", ""]}>
                {q.takeoff.lines.map((x) => (
                  <tr key={x.sku}>
                    <Td><Mono>{x.sku}</Mono><div className="text-xs text-muted">{x.name}</div></Td>
                    <Td className="tabular">{fmtNum(x.qty, l)}</Td>
                    <Td className="tabular text-muted">{fmtNum(x.available, l)}</Td>
                    <Td>{x.shortfall > 0 ? <Pill tone="red">short {fmtNum(x.shortfall, l)}</Pill> : <Pill tone="green">OK</Pill>}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
