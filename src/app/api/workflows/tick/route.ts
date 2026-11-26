import { NextResponse } from "next/server";
import "@/lib/workflows/estimate"; // registers workflow definitions
import { tick } from "@/lib/workflows/engine";
import { dispatchNotifications } from "@/lib/channels";
import { runAllAgents } from "@/lib/agents/personal";
import { refreshAiMode } from "@/lib/ai/provider";

// Called by Vercel Cron; also fans notifications out to email / WhatsApp / SMS.
// (Authorization: Bearer CRON_SECRET) to resume queued or interrupted workflows.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  await refreshAiMode();
  const resumed = await tick();
  const agents = await runAllAgents(); // each person's agent: briefing, standing jobs, chasing, inbox triage
  return NextResponse.json({ resumed, agents, notifications: await dispatchNotifications() });
}
