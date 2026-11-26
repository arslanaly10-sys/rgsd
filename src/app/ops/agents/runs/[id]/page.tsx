import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, PageHeader, Pill } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { one, rows, withUser } from "@/lib/db";
import { fmtDate, type Loc } from "@/lib/format";

export default async function RunTrace({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withUser(s, async (db) => {
    const run = await one<{ agent: string; status: string; mode: string; model: string | null; input: { text: string; page?: string }; output: { reply?: string } | null; tokens_in: number; tokens_out: number; cost_usd: string; latency_ms: number | null; created_at: string; error: string | null; user_name: string | null }>(db,
      "select r.*, p.full_name user_name from agent_runs r left join profiles p on p.id = r.user_id where r.id = $1", [id]);
    const steps = await rows<{ idx: number; kind: string; name: string; input: unknown; output: unknown; tier: number | null; latency_ms: number | null }>(db, "select idx, kind, name, input, output, tier, latency_ms from agent_steps where run_id = $1 order by idx", [id]);
    return { run, steps };
  });
  if (!data.run) notFound();
  const r = data.run;
  const tone: Record<string, "dark" | "neutral" | "yellow" | "red" | "green"> = { handoff: "neutral", llm: "dark", tool: "green", approval: "yellow", guardrail: "red" };
  return (
    <>
      <PageHeader title={`${t("agentsPage.trace")}: ${r.agent}`} sub={`${r.user_name ?? ""} · ${fmtDate(r.created_at, l)} · ${r.mode} · ${r.model ?? ""} · ${r.tokens_in + r.tokens_out} tokens · ${r.latency_ms ?? "—"} ms`} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card title="Conversation turn">
          <p className="eyebrow">Request</p>
          <p className="mt-1 text-sm">{r.input.text}</p>
          <p className="eyebrow mt-4">Reply</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{r.output?.reply ?? r.error}</p>
        </Card>
        <Card title={`Steps (${data.steps.length})`}>
          <ol className="grid gap-3">
            {data.steps.map((st) => (
              <li key={st.idx} className="min-w-0 rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-xs text-muted">#{st.idx}</span>
                  <Pill tone={tone[st.kind] ?? "neutral"}>{st.kind}</Pill>
                  <span className="font-mono text-[12.5px] font-medium">{st.name}</span>
                  {st.tier != null && <Pill tone={st.tier >= 3 ? "red" : st.tier === 2 ? "yellow" : "neutral"}>T{st.tier}</Pill>}
                  {st.latency_ms != null && <span className="text-xs text-muted">{st.latency_ms} ms</span>}
                </div>
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted">input / output</summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded bg-canvas p-2 text-[11px] leading-snug" dir="ltr">{JSON.stringify({ input: st.input, output: st.output }, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
