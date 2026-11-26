import { NextResponse } from "next/server";
import "@/lib/workflows/estimate"; // registers workflow definitions
import { tick } from "@/lib/workflows/engine";
import { dispatchNotifications } from "@/lib/channels";

// Called by Vercel Cron; also fans notifications out to email / WhatsApp / SMS.
// (Authorization: Bearer CRON_SECRET) to resume queued or interrupted workflows.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const resumed = await tick();
  return NextResponse.json({ resumed, notifications: await dispatchNotifications() });
}
