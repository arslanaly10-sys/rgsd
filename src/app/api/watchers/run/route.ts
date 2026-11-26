import { NextResponse } from "next/server";
import { runAllWatchers } from "@/lib/watchers/compliance";

// Vercel Cron: daily (see vercel.json). Requires Authorization: Bearer CRON_SECRET.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return NextResponse.json(await runAllWatchers());
}
