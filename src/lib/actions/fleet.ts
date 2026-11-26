"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { one, rows, withSystem, withUser } from "@/lib/db";
import { invokeTool } from "@/lib/agents/policy";
import { readDeliveryNote } from "@/lib/agents/delivery-note";
import { completeMovement, FleetError } from "@/lib/fleet";
import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES, putFile, sniffMime } from "@/lib/storage";
import { runMaterialsWatcher } from "@/lib/watchers/compliance";

const back = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
const YARD_ROLES = ["admin", "ops_manager", "yard_logistics"];

/** Photo or PDF of a delivery note → draft movement with matched lines, for the yard to check and complete. */
export async function intakeDeliveryNote(formData: FormData) {
  const s = await requireSession("staff");
  const path = "/ops/fleet/movements/new";
  if (!YARD_ROLES.includes(s.role)) back(path, "err:Only Yard & Logistics or Operations can log delivery notes.");
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) back(path, "err:Choose the delivery note photo or PDF.");
  const f = file as File;
  if (f.size > MAX_UPLOAD_BYTES) back(path, "err:The file is larger than 15 MB.");
  const buf = Buffer.from(await f.arrayBuffer());
  const mime = sniffMime(buf, f.type);
  if (!mime) back(path, "err:Upload a PDF, photo or text file.");
  let read;
  try { read = await readDeliveryNote({ mime: mime!, data: buf, name: f.name }); }
  catch (e) { back(path, `err:${(e as Error).message}`); }
  const dn = read!.dn;
  const siteCode = String(formData.get("site") || "") || dn.site_code;
  const r = await withUser(s, async (db) => {
    const site = siteCode ? await one<{ id: string; client_company_id: string; loc: string }>(db, "select si.id, si.client_company_id, l.id loc from sites si join locations l on l.site_id = si.id where si.code = $1", [siteCode]) : undefined;
    if (!site) return { err: "Which site is this delivery note for? Pick the site and upload again." };
    const yard = await one<{ id: string }>(db, "select id from locations where kind = 'yard' and name like $1 limit 1", [siteCode === "SDR" ? "Jubail%" : "Dammam%"]);
    const items = await rows<{ id: string; sku: string; name: string }>(db, "select id, sku, name from items");
    const matched: { item_id: string; sku: string; qty: number }[] = [];
    const unmatched: string[] = [];
    for (const l of dn.lines) {
      const it = items.find((x) => l.sku && x.sku === l.sku.toUpperCase()) ?? items.find((x) => l.description && x.name.toLowerCase().includes(l.description.toLowerCase()));
      if (it) matched.push({ item_id: it.id, sku: it.sku, qty: l.qty }); else unmatched.push(`${l.description} × ${l.qty}`);
    }
    const ref = await one<{ ref: string }>(db, "select 'MV-' || lpad((coalesce(max(substring(ref from '\\d+$')::int),0) + 1)::text, 5, '0') ref from movements");
    const key = `${s.orgId}/delivery-notes/${randomUUID()}.${ALLOWED_UPLOADS[mime!]}`;
    await putFile(key, buf, mime!);
    const delivery = dn.direction === "delivery";
    const m = await one<{ id: string }>(db,
      `insert into movements (org_id, client_company_id, site_id, kind, ref, from_location_id, to_location_id, delivery_note_no, status, scheduled_for, document_path, ai_extracted, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'in_transit', coalesce($9::date, current_date), $10, $11, $12) returning id`,
      [s.orgId, site.client_company_id, site.id, dn.direction, ref!.ref, delivery ? yard?.id : site.loc, delivery ? site.loc : yard?.id, dn.dn_no, dn.date, key, JSON.stringify({ ...dn, unmatched, mode: read!.mode }), s.id]);
    for (const l of matched) await db.query("insert into movement_lines (org_id, movement_id, item_id, qty) values ($1,$2,$3,$4)", [s.orgId, m!.id, l.item_id, l.qty]);
    return { id: m!.id, ref: ref!.ref, matched: matched.length, unmatched };
  });
  if ("err" in r) back(path, `err:${r.err}`);
  const ok = r as { id: string; ref: string; matched: number; unmatched: string[] };
  redirect(`/ops/fleet/movements/${ok.id}?msg=${encodeURIComponent(`ok:${ok.ref} drafted from the delivery note: ${ok.matched} line(s) matched${ok.unmatched.length ? `, ${ok.unmatched.length} not recognised (${ok.unmatched.join("; ")})` : ""}. Check it against the load, then complete.`)}`);
}

export async function completeMovementAction(formData: FormData) {
  const s = await requireSession("staff");
  const id = String(formData.get("id"));
  const path = `/ops/fleet/movements/${id}`;
  if (!YARD_ROLES.includes(s.role)) back(path, "err:Only Yard & Logistics or Operations can complete movements.");
  let msg: string;
  try {
    const r = await completeMovement(s, id);
    msg = `ok:${r.ref} completed. Stock and on-hire are updated.${r.notes.length ? " " + r.notes.join(" ") : ""}`;
  } catch (e) {
    msg = `err:${e instanceof FleetError ? e.message : "Couldn't complete the movement."}`;
    if (!(e instanceof FleetError)) console.error("[completeMovement]", e);
  }
  revalidatePath("/ops/fleet");
  back(path, msg);
}

export async function planDispatchAction(formData: FormData) {
  const s = await requireSession("staff");
  const date = String(formData.get("date") || "");
  const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "plan_dispatch", date ? { date } : {});
  revalidatePath("/ops/fleet/dispatch");
  back("/ops/fleet/dispatch", r.kind === "result" ? `ok:Draft plan ready for ${String((r.output.plan as { date: string })?.date ?? date)}. Review the trips, then submit it for approval.` : `err:${r.output.brief_en}`);
}

export async function submitDispatchAction(formData: FormData) {
  const s = await requireSession("staff");
  const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "approve_dispatch_plan", { plan_id: String(formData.get("id")) });
  revalidatePath("/ops/fleet/dispatch");
  back("/ops/fleet/dispatch", r.kind === "approval" ? "ok:Submitted. Another Yard & Logistics lead or the Operations Manager confirms it." : r.kind === "result" ? `ok:${r.output.brief_en}` : `err:${r.output.brief_en}`);
}

export async function runMaterialsCheck() {
  const s = await requireSession("staff");
  const r = await runMaterialsWatcher(s.orgId);
  revalidatePath("/ops", "layout");
  back("/ops/fleet/reconciliation", `ok:${r.gaps} gap(s) found, ${r.created} new task(s) created.`);
}

export async function draftInvoicesAction() {
  const s = await requireSession("staff");
  const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "draft_invoices", {});
  revalidatePath("/ops/billing");
  back("/ops/billing", r.kind === "result" ? `ok:${String(r.output.brief_en).split("\n")[0]}` : `err:${r.output.brief_en}`);
}

export async function submitInvoiceAction(formData: FormData) {
  const s = await requireSession("staff");
  const id = String(formData.get("id"));
  const path = `/ops/billing/${id}`;
  const inv = await withUser(s, (db) => one<{ ref: string; status: string; po_number: string | null }>(db, "select ref, status, po_number from invoices where id = $1", [id]));
  if (!inv) back(path, "err:Invoice not found.");
  if (inv!.status !== "draft") back(path, `err:Invoice is already ${inv!.status.replace(/_/g, " ")}.`);
  const r = await invokeTool({ session: s, runId: null, locale: s.locale }, "issue_invoice", { invoice_ref: inv!.ref });
  if (r.kind === "approval") await withSystem((db) => db.query("update invoices set status='pending_approval' where id=$1", [id]), { actorId: s.id });
  revalidatePath(path);
  back(path, r.kind === "approval" ? `ok:Submitted to Finance for approval.${inv!.po_number ? "" : " Note: there is no client PO on this invoice yet."}` : r.kind === "result" ? `ok:${r.output.brief_en}` : `err:${r.output.brief_en}`);
}
