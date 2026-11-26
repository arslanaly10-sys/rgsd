import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { rows, withUser } from "@/lib/db";
import { fmtDate, type Loc } from "@/lib/format";
import { Card, PageHeader, Pill, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { policies } from "@/lib/queries";

export default async function Page() {
  const s = await requireSession("staff");
  const t = await getTranslations();
  const l = (await getLocale()) as Loc;
  const list = await policies(s);
  const runs = await withUser(s, (db) => rows<{ id: string; agent: string; channel: string; status: string; mode: string; created_at: string; tokens_in: number; tokens_out: number; latency_ms: number | null; feedback: string | null; text: string; user_name: string | null }>(db,
    `select r.id, r.agent, r.channel, r.status, r.mode, r.created_at, r.tokens_in, r.tokens_out, r.latency_ms, r.feedback, r.input->>'text' text, p.full_name user_name
     from agent_runs r left join profiles p on p.id = r.user_id order by r.created_at desc limit 30`));
  const tone = (tier: number) => (tier === 0 ? "green" : tier === 1 ? "neutral" : tier === 2 ? "yellow" : "red") as "green" | "neutral" | "yellow" | "red";
  return (
    <>
      <PageHeader title={t("nav.agents")} sub={t("pages.agentsSub")} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((tier) => (
          <div key={tier} className="rounded-xl border border-line bg-panel p-4">
            <Pill tone={tone(tier)}>T{tier}</Pill>
            <p className="mt-2 text-sm">{t(`tiers.${tier}`)}</p>
          </div>
        ))}
      </div>
      <Card title={t("agentsPage.runs")} className="mb-4">
        <Table head={["", "Agent", "Request", "User", t("cols.status"), t("agentsPage.tokens"), t("agentsPage.latency"), t("agentsPage.feedback")]} empty={runs.length ? undefined : t("agentsPage.noRuns")}>
          {runs.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.created_at, l)}</Td>
              <Td><Pill tone="dark">{r.agent}</Pill> <span className="text-[11px] text-muted">{r.mode}</span></Td>
              <Td className="max-w-[340px]"><Link href={`/ops/agents/runs/${r.id}`} className="line-clamp-2 hover:text-brand">{r.text}</Link></Td>
              <Td className="whitespace-nowrap text-xs">{r.user_name}</Td>
              <Td><Pill tone={r.status === "completed" ? "green" : r.status === "failed" ? "red" : "yellow"}>{r.status}</Pill></Td>
              <Td className="tabular text-xs">{r.tokens_in + r.tokens_out}</Td>
              <Td className="tabular text-xs">{r.latency_ms ?? "—"} ms</Td>
              <Td>{r.feedback === "up" ? "👍" : r.feedback === "down" ? "👎" : ""}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Autonomy policy">
        <Table head={["Tool", "Tier", "Who can trigger", "Runs without approval for", "Approvers"]}>
          {list.map((p) => (
            <tr key={p.tool}>
              <Td><div className="font-mono text-[12.5px] font-medium">{p.tool}</div><div className="text-xs text-muted">{p.description}</div></Td>
              <Td><Pill tone={tone(p.tier)}>T{p.tier}</Pill></Td>
              <Td className="max-w-[260px] text-xs text-muted">{p.allowed_roles.map((r) => t(`roles.${r}`)).join(", ")}</Td>
              <Td className="text-xs text-muted">{p.tier <= 1 ? "Everyone allowed" : p.auto_roles.map((r) => t(`roles.${r}`)).join(", ") || "Nobody"}</Td>
              <Td className="text-xs text-muted">{p.approver_roles.map((r) => t(`roles.${r}`)).join(", ") || "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
