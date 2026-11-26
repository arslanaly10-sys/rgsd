import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runTurn } from "@/lib/agents/runner";

const Body = z.object({ text: z.string().min(1).max(4000), conversationId: z.string().uuid().optional(), page: z.string().max(200).optional(), locale: z.enum(["en", "ar"]).optional() });

// Simple per-user rate limit (per server instance).
const hits = new Map<string, number[]>();
function limited(id: string) {
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(id, recent);
  return recent.length > 20;
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Sign in to use the copilot." }, { status: 401 });
  if (limited(s.id)) return NextResponse.json({ error: "Too many messages in a minute. Wait a moment and try again." }, { status: 429 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Message is empty or too long." }, { status: 400 });
  const r = await runTurn(s, { ...body.data, locale: body.data.locale ?? s.locale, channel: "web" });
  return NextResponse.json(r);
}
