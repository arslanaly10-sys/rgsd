import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Flash, Mono, PageHeader, Pill, statusTone } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { fmtDate, fmtSAR, L, type Loc } from "@/lib/format";
import { runEstimator, uploadRequestDocument } from "@/lib/actions/quotes";
import { SubmitButton } from "@/components/submit-button";

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const { id } = await params;
  const { msg } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await withUser(s, async (db) => {
    const r = await one<{ id: string; ref: string; title: string; description: string | null; source: string; status: string; priority: string; required_by: string | null; created_at: string; scaffold_type: string | null; client: string; client_ar: string | null; site_code: string | null; site_name: string | null; site_name_ar: string | null; access: string | null; ai_summary: { questions?: string[]; confidence?: number } | null; workflow_run_id: string | null }>(db,
      `select r.*, c.name client, c.name_ar client_ar, si.code site_code, si.name site_name, si.name_ar site_name_ar, si.access_requirements access
       from requests r join client_companies c on c.id = r.client_company_id left join sites si on si.id = r.site_id where r.id = $1`, [id]);
    if (!r) return null;
    const docs = await rows<{ id: string; title: string; kind: string; mime: string; size_bytes: string; created_at: string }>(db, "select id, title, kind, mime, size_bytes, created_at from documents where entity_type='request' and entity_id=$1 order by created_at", [id]);
    const quotes = await rows<{ id: string; ref: string; status: string; total: string; ai_generated: boolean; ai_confidence: string | null; created_at: string }>(db, "select id, ref, status, total, ai_generated, ai_confidence, created_at from quotes where request_id=$1 order by created_at desc", [id]);
    const steps = r.workflow_run_id ? await rows<{ name: string; status: string; error: string | null; finished_at: string | null }>(db, "select name, status, error, finished_at from workflow_steps where workflow_run_id=$1 order by started_at", [r.workflow_run_id]) : [];
    const memories = await rows<{ content: string }>(db, "select content from memories where client_company_id = (select client_company_id from requests where id=$1) order by created_at desc limit 3", [id]);
    return { r, docs, quotes, steps, memories };
  });
  if (!d) notFound();
  const { r } = d;
  const canEstimate = ["admin", "ops_manager", "estimator"].includes(s.role);
  return (
    <>
      <Link href="/ops/requests" className="text-sm text-muted hover:text-ink">← {t("nav.requests")}</Link>
      <PageHeader title={`${r.ref} · ${r.title}`} sub={`${L(r, "client", l)}${r.site_code ? ` · ${r.site_code} ${L(r, "site_name", l)}` : ""}`}
        actions={<><Pill tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Pill><Pill tone={statusTone(r.priority)}>{t(`status.${r.priority}`)}</Pill></>} />
      <Flash msg={msg} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          <Card title="Request">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted">{t("cols.source")}</dt><dd>{t(`types.${r.source}`)}</dd></div>
              <div><dt className="text-xs text-muted">{t("cols.requiredBy")}</dt><dd>{fmtDate(r.required_by, l)}</dd></div>
              <div><dt className="text-xs text-muted">{t("cols.type")}</dt><dd>{r.scaffold_type ? t(`types.${r.scaffold_type}`) : "—"}</dd></div>
              <div><dt className="text-xs text-muted">Logged</dt><dd>{fmtDate(r.created_at, l)}</dd></div>
            </dl>
            {r.description && <p className="mt-4 max-w-[70ch] whitespace-pre-wrap text-sm">{r.description}</p>}
            {r.access && <p className="mt-4 rounded-lg bg-canvas p-3 text-xs text-muted"><strong className="text-ink">Site access: </strong>{r.access}</p>}
            {d.memories.length > 0 && <ul className="mt-3 grid gap-1 text-xs text-muted">{d.memories.map((m, i) => <li key={i}>🧠 {m.content}</li>)}</ul>}
          </Card>
          <Card title={`Documents (${d.docs.length})`}>
            <ul className="mb-4 grid gap-2 text-sm">
              {d.docs.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="min-w-0 truncate">📄 {x.title}</span>
                  <span className="shrink-0 text-xs text-muted">{x.kind} · {Math.ceil(Number(x.size_bytes) / 1024)} KB</span>
                </li>
              ))}
              {!d.docs.length && <li className="text-muted">No documents yet. Upload the RFQ, drawings, BOQ or site photos.</li>}
            </ul>
            <form action={uploadRequestDocument} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="requestId" value={r.id} />
              <input id="file" type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" className="min-w-0 flex-1 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold" />
              <select id="kind" name="kind" className="rounded-lg border border-line px-3 py-2 text-sm">
                {["rfq", "drawing", "boq", "photo", "other"].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
              </select>
              <SubmitButton className="rounded-lg border border-line bg-panel px-3 py-2 text-sm font-semibold hover:bg-canvas" pending="Uploading…">Upload</SubmitButton>
            </form>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card title="AI Estimator">
            <p className="text-sm text-muted">Reads the request and documents, extracts each scaffold&apos;s scope, does the material take-off and yard stock check, prices it on the active rate card and saves a <strong>draft</strong>. Nothing is sent to the client without approval.</p>
            {canEstimate && (
              <form action={runEstimator} className="mt-4">
                <input type="hidden" name="requestId" value={r.id} />
                <SubmitButton className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600" pending="Estimator working…">{d.quotes.length ? "Re-run Estimator (new draft)" : "Run Estimator"}</SubmitButton>
              </form>
            )}
            {d.steps.length > 0 && (
              <ol className="mt-4 grid gap-1.5 text-sm">
                {d.steps.map((st) => (
                  <li key={st.name} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px]">{st.name}</span>
                    <Pill tone={st.status === "completed" ? "green" : st.status === "failed" ? "red" : "yellow"}>{st.status}</Pill>
                  </li>
                ))}
              </ol>
            )}
            {!!r.ai_summary?.questions?.length && (
              <div className="mt-4 rounded-lg bg-tag-yellow-bg p-3 text-sm text-tag-yellow">
                <p className="font-semibold">Clarify with the client</p>
                <ul className="mt-1 list-disc ps-5">{r.ai_summary.questions.map((q) => <li key={q}>{q}</li>)}</ul>
              </div>
            )}
          </Card>
          <Card title="Quotes">
            <ul className="grid gap-2 text-sm">
              {d.quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/ops/quotes/${q.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 hover:border-brand">
                    <span><Mono>{q.ref}</Mono> {q.ai_generated && <Pill tone="dark">AI</Pill>}</span>
                    <span className="flex items-center gap-2"><span className="tabular font-medium">{fmtSAR(q.total, l)}</span><Pill tone={statusTone(q.status)}>{t(`status.${q.status}`)}</Pill></span>
                  </Link>
                </li>
              ))}
              {!d.quotes.length && <li className="text-muted">No quotes yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
