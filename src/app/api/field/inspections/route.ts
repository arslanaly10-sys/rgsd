import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { InspectionError, InspectionIn, recordInspection } from "@/lib/inspections";

export const maxDuration = 60;

export async function POST(req: Request) {
  const s = await getSession();
  if (!s || !s.isStaff) return NextResponse.json({ error: "Sign in as RGS staff to submit inspections." }, { status: 401 });
  const body = InspectionIn.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "The inspection form is incomplete.", issues: body.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  try {
    return NextResponse.json(await recordInspection(s, body.data));
  } catch (e) {
    if (e instanceof InspectionError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[inspection]", e);
    return NextResponse.json({ error: "The server couldn't save the inspection. It stays in your outbox and will retry." }, { status: 500 });
  }
}
