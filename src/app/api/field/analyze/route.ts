import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { suggestTag } from "@/lib/checklist";
import { decodePhotos, detectDefects, PhotoIn } from "@/lib/inspections";

export const maxDuration = 60;
const Body = z.object({ tag_no: z.string().max(20), checklist: z.array(z.object({ code: z.string(), result: z.enum(["pass", "fail", "na"]) })), photos: z.array(PhotoIn).max(8) });

/** Preview: AI photo check plus suggested tag, before the inspector signs. Writes nothing. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || !s.isStaff) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const det = await detectDefects(decodePhotos(b.data.photos), b.data.tag_no);
    return NextResponse.json({ findings: det.findings, suggestion: suggestTag(b.data.checklist, det.findings), note: det.note, mode: det.mode });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
