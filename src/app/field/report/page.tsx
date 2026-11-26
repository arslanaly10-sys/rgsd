import Link from "next/link";
import { Flash } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { rows, withUser } from "@/lib/db";
import { voiceReportAction } from "./actions";
import { Dictation } from "./dictation";

export const dynamic = "force-dynamic";

export default async function VoiceReport({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const { msg } = await searchParams;
  const areas = await withUser(s, (db) => rows<{ id: string; code: string; name: string; ref: string; uom: string }>(db,
    "select a.id, a.code, a.name, p.ref, a.uom from project_areas a join projects p on p.id = a.project_id where a.status <> 'complete' order by (a.status = 'in_progress') desc, p.ref, a.sort"));
  return (
    <main className="grid gap-4 p-4">
      <Link href="/field" className="text-sm text-brand">← Field</Link>
      <h1 className="text-xl font-semibold">End-of-shift report</h1>
      <p className="text-sm text-muted">Speak in your language: how much you finished, which stage, and any problem (wind, missing material, waiting for permit). Your Crew agent turns it into a progress entry.</p>
      <Flash msg={msg} />
      <form action={voiceReportAction} className="grid gap-3 rounded-xl border border-line bg-panel p-4">
        <select name="areaId" required aria-label="Area" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">{areas.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.code} {a.name} ({a.uom})</option>)}</select>
        <Dictation />
        <SubmitButton className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white" pending="Reading your report…">Send report</SubmitButton>
      </form>
    </main>
  );
}
