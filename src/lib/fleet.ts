import "server-only";
import type { Session } from "./auth";
import { one, rows, withSystem, withUser, type Db } from "./db";

/* Fleet & logistics engine: movement completion (stock and on-hire), material reconciliation, dispatch planning. */

export class FleetError extends Error {}

async function addStock(db: Db, orgId: string, itemId: string, locationId: string, delta: number) {
  await db.query(
    `insert into stock (org_id, item_id, location_id, qty) values ($1,$2,$3,$4)
     on conflict (item_id, location_id) do update set qty = stock.qty + excluded.qty`, [orgId, itemId, locationId, delta]);
}

/** Complete a delivery, return or transfer: moves stock and opens or closes on-hire lines so billing follows the material. */
export async function completeMovement(s: Session, movementId: string) {
  return withUser(s, async (db) => {
    const m = await one<{ id: string; org_id: string; kind: string; status: string; site_id: string | null; client_company_id: string | null; from_location_id: string | null; to_location_id: string | null; ref: string }>(db,
      "select id, org_id, kind, status, site_id, client_company_id, from_location_id, to_location_id, ref from movements where id = $1 for update", [movementId]);
    if (!m) throw new FleetError("Movement not found.");
    if (!["planned", "in_transit"].includes(m.status)) throw new FleetError(`${m.ref} is already ${m.status}.`);
    const lines = await rows<{ item_id: string; qty: string; sku: string; rate: string }>(db,
      "select ml.item_id, ml.qty, i.sku, i.rental_rate_day rate from movement_lines ml join items i on i.id = ml.item_id where ml.movement_id = $1", [movementId]);
    if (!lines.length) throw new FleetError("Add at least one line before completing.");
    const notes: string[] = [];

    if (m.kind === "delivery" || m.kind === "transfer") {
      if (!m.from_location_id) throw new FleetError("Movement has no source yard.");
      for (const l of lines) {
        const st = await one<{ qty: string }>(db, "select qty from stock where item_id = $1 and location_id = $2", [l.item_id, m.from_location_id]);
        if (Number(st?.qty ?? 0) < Number(l.qty)) throw new FleetError(`Not enough ${l.sku} in the yard (${Number(st?.qty ?? 0)} available, ${Number(l.qty)} needed).`);
        await addStock(db, m.org_id, l.item_id, m.from_location_id, -Number(l.qty));
      }
    }
    if (m.kind === "delivery") {
      if (!m.site_id || !m.client_company_id) throw new FleetError("Delivery has no site.");
      const job = await one<{ id: string }>(db, "select id from jobs where site_id = $1 and status in ('active','mobilising') order by start_date desc limit 1", [m.site_id]);
      for (const l of lines) {
        await db.query(`insert into on_hire (org_id, client_company_id, site_id, job_id, item_id, qty, rate_day, start_date) values ($1,$2,$3,$4,$5,$6,$7, current_date)`,
          [m.org_id, m.client_company_id, m.site_id, job?.id ?? null, l.item_id, l.qty, l.rate]);
      }
      notes.push(`${lines.length} line(s) now on hire from today.`);
    }
    if (m.kind === "return") {
      if (!m.to_location_id || !m.site_id) throw new FleetError("Return needs a site and a yard.");
      for (const l of lines) {
        await addStock(db, m.org_id, l.item_id, m.to_location_id, Number(l.qty));
        // Close on-hire oldest first; split a line when only part of it comes back so billing stays exact.
        let left = Number(l.qty);
        const hire = await rows<{ id: string; qty: string }>(db,
          "select id, qty from on_hire where site_id = $1 and item_id = $2 and status in ('on_hire','off_hire_requested') order by (status = 'off_hire_requested') desc, start_date for update", [m.site_id, l.item_id]);
        for (const h of hire) {
          if (left <= 0) break;
          const q = Number(h.qty);
          if (q <= left) {
            await db.query("update on_hire set status = 'returned', end_date = current_date where id = $1", [h.id]);
            left -= q;
          } else {
            await db.query("update on_hire set qty = qty - $2::numeric where id = $1", [h.id, left]);
            await db.query(`insert into on_hire (org_id, client_company_id, site_id, job_id, item_id, qty, rate_day, start_date, end_date, status, last_billed_until)
                            select org_id, client_company_id, site_id, job_id, item_id, $2, rate_day, start_date, current_date, 'returned', last_billed_until from on_hire where id = $1`, [h.id, left]);
            left = 0;
          }
        }
        if (left > 0) notes.push(`${l.sku}: ${left} more returned than were on hire. Check the delivery note.`);
      }
    }
    if (m.kind === "transfer" && m.to_location_id) for (const l of lines) await addStock(db, m.org_id, l.item_id, m.to_location_id, Number(l.qty));
    await db.query("update movements set status = 'completed', completed_at = now() where id = $1", [movementId]);
    return { ref: m.ref, kind: m.kind, notes };
  });
}

export type Variance = { site_code: string; site_name: string; sku: string; item: string; delivered: number; returned: number; on_hire: number; expected_on_site: number; variance: number; value: number; kind: "unbilled_or_lost" | "billing_not_on_site" };

/** Delivered − returned should equal what is on hire. A positive gap is material on site but not billed (or lost); a negative gap is rental charged for material that came back. */
export async function reconcile(s: Session, siteCode?: string): Promise<Variance[]> {
  const r = await withUser(s, (db) => rows<{ site_code: string; site_name: string; sku: string; item: string; delivered: string; returned: string; on_hire: string; replacement_value: string }>(db,
    `with mv as (
       select m.site_id, ml.item_id,
              sum(ml.qty) filter (where m.kind = 'delivery') delivered,
              sum(ml.qty) filter (where m.kind = 'return') returned
       from movements m join movement_lines ml on ml.movement_id = m.id
       where m.status = 'completed' and m.site_id is not null group by 1,2),
     oh as (select site_id, item_id, sum(qty) on_hire from on_hire where status in ('on_hire','off_hire_requested') group by 1,2)
     select si.code site_code, si.name site_name, i.sku, i.name item, coalesce(mv.delivered,0) delivered, coalesce(mv.returned,0) returned, coalesce(oh.on_hire,0) on_hire, i.replacement_value
     from mv full join oh using (site_id, item_id) join sites si on si.id = coalesce(mv.site_id, oh.site_id) join items i on i.id = coalesce(mv.item_id, oh.item_id)
     where ($1::text is null or si.code = $1)`, [siteCode ?? null]));
  return r.map((x) => {
    const delivered = Number(x.delivered), returned = Number(x.returned), onHire = Number(x.on_hire);
    const expected = delivered - returned, variance = expected - onHire;
    return { site_code: x.site_code, site_name: x.site_name, sku: x.sku, item: x.item, delivered, returned, on_hire: onHire, expected_on_site: expected, variance, value: Math.abs(variance) * Number(x.replacement_value), kind: variance > 0 ? "unbilled_or_lost" as const : "billing_not_on_site" as const };
  }).filter((v) => v.variance !== 0).sort((a, b) => b.value - a.value);
}

// ───────────────────────── Dispatch planner ─────────────────────────

const YARD = { name: "Dammam 2nd Industrial Yard", lat: 26.43, lng: 50.1 };
const TANAJIB = { name: "Tanajib marine base (boat transfer)", lat: 27.87, lng: 48.86 };

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.3; // road factor
};

export type Stop = { site_code: string; site_name: string; kind: "delivery" | "collection"; movement_id?: string; on_hire_ids?: string[]; lat: number; lng: number; via?: string; window: "day" | "night"; lines: { sku: string; qty: number; kg: number }[]; kg: number };
export type Trip = { vehicle: { id: string; plate: string; kind: string; capacity_kg: number; driver: string | null }; window: "day" | "night"; stops: Stop[]; load_kg: number; utilisation: number; est_km: number; est_hours: number };
export type Plan = { date: string; trips: Trip[]; unassigned: Stop[]; warnings: string[] };

export async function planDispatch(s: Session, date: string): Promise<{ planId: string; plan: Plan }> {
  const data = await withUser(s, async (db) => {
    const deliveries = await rows<{ id: string; site_code: string; site_name: string; lat: number; lng: number; type: string; access: string | null; sku: string; qty: string; kg: string }>(db,
      `select m.id, si.code site_code, si.name site_name, si.lat, si.lng, si.type, si.access_requirements access, i.sku, ml.qty, ml.qty * i.weight_kg kg
       from movements m join sites si on si.id = m.site_id join movement_lines ml on ml.movement_id = m.id join items i on i.id = ml.item_id
       where m.kind = 'delivery' and m.status = 'planned' and m.scheduled_for = $1::date`, [date]);
    const pickups = await rows<{ id: string; site_code: string; site_name: string; lat: number; lng: number; type: string; access: string | null; sku: string; qty: string; kg: string }>(db,
      `select oh.id, si.code site_code, si.name site_name, si.lat, si.lng, si.type, si.access_requirements access, i.sku, oh.qty, oh.qty * i.weight_kg kg
       from on_hire oh join sites si on si.id = oh.site_id join items i on i.id = oh.item_id
       where oh.status = 'off_hire_requested'
         -- skip pickups already on their way back (a return movement for this site and item is planned or in transit)
         and not exists (select 1 from movements m join movement_lines ml on ml.movement_id = m.id
                         where m.kind = 'return' and m.status in ('planned','in_transit') and m.site_id = oh.site_id and ml.item_id = oh.item_id)`);
    const vehicles = await rows<{ id: string; plate: string; kind: string; capacity_kg: string; driver_name: string | null }>(db,
      "select id, plate, kind, capacity_kg, driver_name from vehicles where status = 'available' and kind in ('flatbed','trailer','crane_truck') order by capacity_kg desc");
    return { deliveries, pickups, vehicles };
  });

  const warnings: string[] = [];
  const stops = new Map<string, Stop>();
  const window = (access: string | null) => (access && /22:00|night/i.test(access) ? "night" : "day") as "day" | "night";
  for (const [list, kind] of [[data.deliveries, "delivery"], [data.pickups, "collection"]] as const) {
    for (const r of list) {
      const key = `${kind}:${kind === "delivery" ? r.id : r.site_code}`;
      const offshore = r.type === "offshore";
      const st = stops.get(key) ?? { site_code: r.site_code, site_name: r.site_name, kind, lat: offshore ? TANAJIB.lat : Number(r.lat), lng: offshore ? TANAJIB.lng : Number(r.lng), via: offshore ? TANAJIB.name : undefined, window: window(r.access), lines: [], kg: 0, ...(kind === "delivery" ? { movement_id: r.id } : { on_hire_ids: [] as string[] }) };
      st.lines.push({ sku: r.sku, qty: Number(r.qty), kg: Math.round(Number(r.kg)) });
      st.kg += Math.round(Number(r.kg));
      if (kind === "collection") st.on_hire_ids!.push(r.id);
      stops.set(key, st);
    }
  }
  for (const st of stops.values()) {
    if (st.via) warnings.push(`${st.site_code}: offshore, truck runs to ${TANAJIB.name}; book the supply boat and check the weather window.`);
    if (st.window === "night") warnings.push(`${st.site_code}: deliveries only 22:00–05:00 (site access rule), planned as a night trip.`);
  }

  // First-fit decreasing by weight, one window per trip; a stop heavier than any truck is split.
  const queue = [...stops.values()].flatMap((st) => {
    const cap = Math.max(...data.vehicles.map((v) => Number(v.capacity_kg)), 1);
    if (st.kg <= cap) return [st];
    const parts = Math.ceil(st.kg / cap);
    warnings.push(`${st.site_code}: ${Math.round(st.kg / 1000)} t needs ${parts} trucks.`);
    return Array.from({ length: parts }, (_, i) => ({ ...st, kg: Math.ceil(st.kg / parts), lines: st.lines.map((l) => ({ ...l, qty: Math.ceil(l.qty / parts) * (i < parts ? 1 : 0) })) }));
  }).sort((a, b) => b.kg - a.kg);

  const trips: Trip[] = [];
  const unassigned: Stop[] = [];
  const free = [...data.vehicles];
  for (const st of queue) {
    const trip = trips.find((t) => t.window === st.window && t.load_kg + st.kg <= t.vehicle.capacity_kg);
    if (trip) { trip.stops.push(st); trip.load_kg += st.kg; continue; }
    const v = free.findIndex((x) => Number(x.capacity_kg) >= st.kg);
    if (v < 0) { unassigned.push(st); continue; }
    const veh = free.splice(v, 1)[0];
    trips.push({ vehicle: { id: veh.id, plate: veh.plate, kind: veh.kind, capacity_kg: Number(veh.capacity_kg), driver: veh.driver_name }, window: st.window, stops: [st], load_kg: st.kg, utilisation: 0, est_km: 0, est_hours: 0 });
  }
  // Nearest-neighbour route from the yard and back.
  for (const t of trips) {
    const ordered: Stop[] = [];
    let here: { lat: number; lng: number } = YARD;
    let dist = 0;
    const left = [...t.stops];
    while (left.length) {
      left.sort((a, b) => km(here, a) - km(here, b));
      const nx = left.shift()!;
      dist += km(here, nx);
      ordered.push(nx);
      here = nx;
    }
    dist += km(here, YARD);
    t.stops = ordered;
    t.est_km = Math.round(dist);
    t.est_hours = Math.round((dist / 60 + 0.75 * ordered.length) * 10) / 10;
    t.utilisation = Math.round((t.load_kg / t.vehicle.capacity_kg) * 100);
  }
  if (unassigned.length) warnings.push(`${unassigned.length} stop(s) have no free truck. Hire a trailer or move them to the next day.`);
  const plan: Plan = { date, trips, unassigned, warnings };
  const r = await withSystem((db) => one<{ id: string }>(db, "insert into dispatch_plans (org_id, plan_date, status, plan) values ($1,$2,'draft',$3) returning id", [s.orgId, date, JSON.stringify(plan)]), { actorId: s.id });
  return { planId: r!.id, plan };
}

/** Run after approval: assign trucks to the planned deliveries and create collection movements for off-hire pickups. */
export async function executeDispatchPlan(s: Session, planId: string) {
  return withUser(s, async (db) => {
    const p = await one<{ status: string; plan: Plan; plan_date: string }>(db, "select status, plan, plan_date::text from dispatch_plans where id = $1 for update", [planId]);
    if (!p) throw new FleetError("Plan not found.");
    if (p.status !== "draft") throw new FleetError(`Plan is already ${p.status}.`);
    const yard = await one<{ id: string }>(db, "select id from locations where kind = 'yard' and name like 'Dammam%' limit 1");
    let deliveries = 0, collections = 0;
    for (const t of p.plan.trips) {
      for (const st of t.stops) {
        if (st.kind === "delivery" && st.movement_id) {
          await db.query("update movements set vehicle_id = $2, status = 'in_transit' where id = $1 and status = 'planned'", [st.movement_id, t.vehicle.id]);
          deliveries++;
        } else if (st.kind === "collection" && st.on_hire_ids?.length) {
          const site = await one<{ id: string; client_company_id: string; loc: string }>(db, "select si.id, si.client_company_id, l.id loc from sites si join locations l on l.site_id = si.id where si.code = $1", [st.site_code]);
          if (!site) continue;
          const ref = await one<{ ref: string }>(db, "select 'MV-' || lpad((coalesce(max(substring(ref from '\\d+$')::int),0) + 1)::text, 5, '0') ref from movements");
          const m = await one<{ id: string }>(db, `insert into movements (org_id, client_company_id, site_id, kind, ref, from_location_id, to_location_id, vehicle_id, status, scheduled_for, created_by)
             values ($1,$2,$3,'return',$4,$5,$6,$7,'in_transit',$8,$9) returning id`, [s.orgId, site.client_company_id, site.id, ref!.ref, site.loc, yard?.id, t.vehicle.id, p.plan_date, s.id]);
          for (const l of st.lines) await db.query("insert into movement_lines (org_id, movement_id, item_id, qty) select $1, $2, id, $4 from items where org_id = $1 and sku = $3", [s.orgId, m!.id, l.sku, l.qty]);
          collections++;
        }
      }
    }
    await db.query("update dispatch_plans set status = 'approved', approved_by = $2 where id = $1", [planId, s.id]);
    return { deliveries, collections, trips: p.plan.trips.length };
  });
}
