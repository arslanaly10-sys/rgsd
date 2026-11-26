"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { one, withSystem, withUser } from "@/lib/db";
import { parseVoiceReport } from "@/lib/field/voice";
import { logProgress } from "@/lib/projects";
import type { ServiceLine } from "@/lib/service-lines";

export async function voiceReportAction(fd: FormData) {
  const s = await requireSession("staff");
  const transcript = String(fd.get("transcript") ?? "").trim().slice(0, 3000);
  const areaId = String(fd.get("areaId") ?? "");
  const lang = String(fd.get("lang") ?? "en-US").slice(0, 10);
  if (transcript.length < 5) redirect("/field/report?msg=" + encodeURIComponent("err:Record or type your report first."));
  const a = await withUser(s, (db) => one<{ id: string; code: string; service_line: ServiceLine; uom: string; stage: string }>(db, "select id, code, service_line, uom, stage from project_areas where id = $1", [areaId]));
  if (!a) redirect("/field/report?msg=" + encodeURIComponent("err:Pick the area you worked on."));
  const p = await parseVoiceReport(transcript, a!);
  let msg: string;
  try {
    const r = await logProgress(s, { areaId: a!.id, qty: p.qty, stage: p.stage, partial: p.partial, notes: `Voice report (${lang}): ${transcript.slice(0, 400)}`.slice(0, 500) });
    msg = `ok:Logged on ${r.code}: ${p.summary_en} Installed now ${r.installed} ${a!.uom}.`;
    await withSystem((db) => db.query(`insert into agent_inbox (org_id, profile_id, job, kind, title, body, link, status) values ($1,$2,'voice_report','done',$3,$4,'/ops/progress','done')`,
      [s.orgId, s.id, `Voice report logged on ${a!.code}: ${p.qty} ${a!.uom}`, `${p.summary_en}\n\nTranscript (${lang}): ${transcript.slice(0, 600)}`]));
    if (p.issues.length) await withSystem((db) => db.query("insert into notifications (org_id, role, kind, title, title_ar, link) values ($1,'ops_manager','site_issue',$2,$3,'/ops/progress')", [s.orgId, `${a!.code}: ${p.issues.join("; ")}`.slice(0, 200), `مشكلة في الموقع ${a!.code}`]));
  } catch (e) { msg = `err:${(e as Error).message}`; }
  revalidatePath("/", "layout");
  redirect("/field/report?msg=" + encodeURIComponent(msg));
}
