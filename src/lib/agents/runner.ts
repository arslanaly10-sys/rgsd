import "server-only";
import type { Session } from "@/lib/auth";
import { one, rows, withSystem } from "@/lib/db";
import { aiMode, estimateCost, provider } from "@/lib/ai/provider";
import { mockRoute } from "@/lib/ai/mock";
import type { ContentBlock, Message, ToolResultBlock, ToolUseBlock } from "@/lib/ai/types";
import { AGENTS, ROUTER_PROMPT, systemPrompt, type AgentName } from "./agents";
import { allowedTools, invokeTool } from "./policy";
import { toolSpecs } from "./tools";
import { POSITION } from "@/lib/positions";

// Each position's home specialist: general questions go to the agent that fits the person's job.
const HOME: Record<string, AgentName> = { general_manager: "briefing", ops_manager: "briefing", project_manager: "briefing", estimator: "estimator", sales_bd: "estimator", commercial_qs: "finance", finance: "finance", qaqc_manager: "inspector", inspector: "inspector", hse_training: "workforce", hr_saudization: "workforce", procurement: "fleet", yard_logistics: "fleet", site_supervisor: "briefing", foreman: "briefing", document_controller: "briefing", admin: "briefing" };

export type TurnStep = { kind: "route" | "tool" | "llm"; name: string; tier?: number; status: "ok" | "approval" | "denied" | "error"; approvalId?: string };
export type TurnResult = { runId: string; conversationId: string; agent: AgentName; agentLabel: string; reply: string; steps: TurnStep[]; mode: "mock" | "live"; error?: string };

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator", ops_manager: "Operations Manager", estimator: "Estimator", site_supervisor: "Site Supervisor", inspector: "Scaffold Inspector",
  yard_logistics: "Yard & Logistics", hse_training: "HSE & Training", finance: "Finance", client_admin: "Client admin", client_user: "Client user", client_viewer: "Client viewer (read-only)",
};
const MAX_ITERATIONS = 6;

async function route(session: Session, text: string): Promise<AgentName> {
  if (!session.isStaff) return "concierge"; // clients only ever reach the client-scoped agent
  if (aiMode() === "mock") return mockRoute(text, true) as AgentName;
  try {
    const r = await provider().complete({ model: "fast", system: ROUTER_PROMPT, messages: [{ role: "user", content: text }], maxTokens: 10 });
    const name = r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim().toLowerCase();
    return (Object.keys(AGENTS) as AgentName[]).find((a) => a !== "concierge" && name.includes(a)) ?? "briefing";
  } catch {
    return mockRoute(text, true) as AgentName;
  }
}

async function history(session: Session, conversationId: string): Promise<Message[]> {
  const prev = await withSystem((db) =>
    rows<{ input: { text: string }; output: { reply?: string } | null }>(db,
      `select input, output from agent_runs where conversation_id = $1 and user_id = $2 and status in ('completed','waiting_approval') order by created_at desc limit 6`, [conversationId, session.id]),
  );
  return prev.reverse().flatMap((r) => (r.output?.reply ? [{ role: "user" as const, content: r.input.text }, { role: "assistant" as const, content: r.output.reply }] : []));
}

async function memories(session: Session) {
  const m = await withSystem((db) =>
    rows<{ content: string }>(db,
      `select content from memories where org_id = $1 and (
         ($2::uuid is not null and client_company_id = $2)
         or ($2::uuid is null and (scope = 'org' or $3))
       ) order by created_at desc limit 8`,
      [session.orgId, session.clientCompanyId, session.isStaff]),
  );
  return m.map((x) => x.content);
}

export async function runTurn(session: Session, input: { text: string; conversationId?: string; page?: string; channel?: "web" | "whatsapp" | "email" | "voice"; locale: "en" | "ar" }): Promise<TurnResult> {
  const started = Date.now();
  const conversationId = input.conversationId && /^[0-9a-f-]{36}$/.test(input.conversationId) ? input.conversationId : crypto.randomUUID();
  const text = input.text.trim().slice(0, 4000);
  const mode = aiMode();
  const steps: TurnStep[] = [];
  let idx = 0;

  let agentName = await route(session, text);
  if (agentName === "briefing" && session.isStaff && HOME[session.position]) agentName = HOME[session.position];
  const agent = AGENTS[agentName];
  const personal = await withSystem((db) => one<{ name: string }>(db, "select name from personal_agents where profile_id = $1", [session.id]));
  const pos = POSITION[session.position];
  const run = await withSystem((db) =>
    one<{ id: string }>(db,
      `insert into agent_runs (org_id, user_id, client_company_id, agent, channel, conversation_id, input, mode, prompt_version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'v1') returning id`,
      [session.orgId, session.id, session.clientCompanyId, agentName, input.channel ?? "web", conversationId, JSON.stringify({ text, page: input.page ?? null }), mode]),
  );
  const runId = run!.id;
  const trace = (kind: "llm" | "tool" | "handoff" | "approval" | "guardrail", name: string, inp: unknown, out: unknown, tier?: number, ms?: number) =>
    withSystem((db) => db.query("insert into agent_steps (org_id, run_id, idx, kind, name, input, output, tier, latency_ms) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [session.orgId, runId, idx++, kind, name, JSON.stringify(inp ?? null), JSON.stringify(out ?? null), tier ?? null, ms ?? null]));

  await trace("handoff", `supervisor → ${agentName}`, { text }, { agent: agentName });
  steps.push({ kind: "route", name: agent.label[input.locale], status: "ok" });

  try {
    const toolNames = await allowedTools(session, agent.tools);
    const tools = toolSpecs(toolNames);
    const system = systemPrompt(agent, {
      locale: input.locale, userName: session.fullName, roleLabel: pos ? `${pos.en}${personal ? `; you are ${personal.name}, their personal agent: ${pos.mission}` : ""}` : ROLE_LABELS[session.role] ?? session.role,
      company: session.companyName, today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }), memories: await memories(session), page: input.page,
    });
    const messages: Message[] = [...(await history(session, conversationId)), { role: "user", content: text }];
    let tokensIn = 0, tokensOut = 0, model = "";
    let reply = "";
    let waiting = false;

    for (let it = 0; it < MAX_ITERATIONS; it++) {
      const t0 = Date.now();
      const res = await provider().complete({ model: agent.model, system, messages, tools, mockHints: { agent: agentName, locale: input.locale } });
      tokensIn += res.usage.input; tokensOut += res.usage.output; model = res.model;
      await trace("llm", res.model, { iteration: it }, { stop: res.stopReason, content: res.content }, undefined, Date.now() - t0);
      const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      if (!uses.length) {
        reply = res.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
        break;
      }
      messages.push({ role: "assistant", content: res.content as ContentBlock[] });
      const results: ToolResultBlock[] = [];
      for (const u of uses) {
        const t1 = Date.now();
        const r = await invokeTool({ session, runId, locale: input.locale }, u.name, u.input);
        await trace(r.kind === "approval" ? "approval" : "tool", u.name, u.input, r.output, r.tier, Date.now() - t1);
        const status = r.kind === "result" ? "ok" : r.kind === "approval" ? "approval" : r.kind === "denied" ? "denied" : "error";
        if (r.kind === "approval") waiting = true;
        steps.push({ kind: "tool", name: u.name, tier: r.tier, status, approvalId: r.kind === "approval" ? r.approvalId : undefined });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r.output).slice(0, 12000), is_error: r.kind === "error" || r.kind === "invalid" });
      }
      messages.push({ role: "user", content: results });
      if (it === MAX_ITERATIONS - 1) reply = input.locale === "ar" ? "توقفت بعد عدة خطوات. حاول تضييق الطلب." : "I stopped after several steps. Try narrowing the request.";
    }

    const summary = reply.split("\n")[0].slice(0, 160);
    await withSystem((db) =>
      db.query(`update agent_runs set status=$2, output=$3, model=$4, tokens_in=$5, tokens_out=$6, cost_usd=$7, latency_ms=$8, completed_at=now() where id=$1`,
        [runId, waiting ? "waiting_approval" : "completed", JSON.stringify({ reply, summary, steps }), model, tokensIn, tokensOut, estimateCost(model, tokensIn, tokensOut), Date.now() - started]),
    );
    return { runId, conversationId, agent: agentName, agentLabel: personal ? `${personal.name} · ${agent.label[input.locale]}` : agent.label[input.locale], reply, steps, mode };
  } catch (e) {
    console.error("[agent run]", e);
    const msg = (e as Error).message;
    await withSystem((db) => db.query("update agent_runs set status='failed', error=$2, latency_ms=$3, completed_at=now() where id=$1", [runId, msg.slice(0, 1000), Date.now() - started]));
    const reply = input.locale === "ar" ? "تعذر إكمال الطلب الآن. تم تسجيل الخطأ للفريق." : "I couldn't finish that right now. The error is logged for the team.";
    return { runId, conversationId, agent: agentName, agentLabel: personal ? `${personal.name} · ${agent.label[input.locale]}` : agent.label[input.locale], reply, steps, mode, error: "run_failed" };
  }
}
