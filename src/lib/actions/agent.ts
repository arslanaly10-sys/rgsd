"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { forceAiModeRefresh } from "@/lib/ai/provider";
import { decideInboxItem, ensureAgent, runAgentCycle, runAllAgents } from "@/lib/agents/personal";

const home = (staff: boolean) => (staff ? "/ops/agent" : "/client/agent");
const back = (path: string, msg: string): never => redirect(`${path}?msg=${encodeURIComponent(msg)}`);

export async function runMyAgentAction() {
  const s = await requireSession();
  await ensureAgent(s);
  const r = await runAgentCycle(s.id, { force: true });
  revalidatePath("/", "layout");
  back(home(s.isStaff), r.paused ? "err:Your agent is paused. Resume it first." : `ok:Your agent ran ${r.ran} job(s) and added ${r.items} item(s).`);
}

export async function decideItemAction(fd: FormData) {
  const s = await requireSession();
  const decision = fd.get("decision") === "dismiss" ? "dismiss" : "approve";
  let msg: string;
  try { msg = `ok:${(await decideInboxItem(s, String(fd.get("id")), decision)).message}`; }
  catch (e) { msg = `err:${e instanceof Error ? e.message : "Something went wrong."}`; }
  revalidatePath("/", "layout");
  back(home(s.isStaff), msg);
}

export async function agentSettingsAction(fd: FormData) {
  const s = await requireSession();
  const autonomy = fd.get("autonomy") === "drafts" ? "drafts" : "routine";
  const paused = fd.get("paused") === "1";
  await withSystem((db) => db.query("update personal_agents set autonomy = $2, paused = $3 where profile_id = $1", [s.id, autonomy, paused]), { actorId: s.id });
  revalidatePath("/", "layout");
  back(home(s.isStaff), `ok:${paused ? "Agent paused." : autonomy === "drafts" ? "Your agent will prepare drafts only; you click every action." : "Your agent handles routine work on its own; money and external actions still need approval."}`);
}

export async function toggleJobAction(fd: FormData) {
  const s = await requireSession();
  await withSystem((db) => db.query("update agent_jobs set enabled = not enabled where id = $1 and profile_id = $2", [String(fd.get("id")), s.id]), { actorId: s.id });
  revalidatePath("/", "layout");
  back(home(s.isStaff), "ok:Standing job updated.");
}

export async function runAllAgentsAction() {
  const s = await requireSession("staff");
  if (s.role !== "admin" && s.position !== "general_manager") back("/ops/agent", "err:Only the GM or an admin runs everyone's agents.");
  const r = await runAllAgents();
  revalidatePath("/", "layout");
  back("/ops/agents/team", `ok:${r.summary}`);
}

export async function setAiModeAction(fd: FormData) {
  const s = await requireSession("staff");
  if (s.role !== "admin") back("/ops/admin", "err:Only an admin changes the AI mode.");
  const mode = ["auto", "mock", "live"].includes(String(fd.get("mode"))) ? String(fd.get("mode")) : "auto";
  await withSystem((db) => db.query("insert into org_settings (org_id, ai_mode) values ($1,$2) on conflict (org_id) do update set ai_mode = excluded.ai_mode, updated_at = now()", [s.orgId, mode]), { actorId: s.id });
  forceAiModeRefresh();
  revalidatePath("/", "layout");
  back("/ops/admin", `ok:AI mode set to ${mode}${mode === "live" && !process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY ? " (no API key is set, so agents keep using the mock until one is added)" : ""}.`);
}
