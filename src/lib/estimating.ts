import "server-only";
import { z } from "zod";
import { rows, withSystem } from "./db";

/* Estimating engine: scope → material take-off → priced lines. Pure functions plus two DB reads (rate card, stock). */

export const SCAFFOLD_TYPES = ["tube_coupler", "system_cuplock", "system_ringlock", "mobile_tower", "suspended", "cantilever", "birdcage", "mast_climber", "hoist"] as const;

export const ScopeItem = z.object({
  description: z.string().max(300).describe("What and where, e.g. 'Birdcage around exchanger E-417'"),
  scaffold_type: z.enum(SCAFFOLD_TYPES),
  length_m: z.number().positive().max(500),
  width_m: z.number().positive().max(60),
  height_m: z.number().positive().max(250).describe("Working platform height plus guardrail, metres"),
  quantity: z.number().int().min(1).max(200).default(1).describe("Number of identical scaffolds"),
  duty: z.enum(["light", "medium", "heavy"]).default("medium"),
  complex: z.boolean().default(false).describe("Congested pipework, irregular geometry or many returns"),
});

export const Scope = z.object({
  items: z.array(ScopeItem).min(1).max(40),
  hire_weeks: z.number().int().min(1).max(156),
  offshore: z.boolean().default(false),
  night_work: z.boolean().default(false),
  site_code: z.string().regex(/^[A-Z]{3}$/).optional(),
  assumptions: z.array(z.string().max(300)).max(15).default([]),
  questions: z.array(z.string().max(300)).max(10).default([]).describe("Clarifications to ask the client before a firm price"),
  confidence: z.number().min(0).max(1).describe("0–1: how sure you are the scope is complete and the dimensions are right"),
});
export type Scope = z.infer<typeof Scope>;
export type ScopeItem = z.infer<typeof ScopeItem>;

// Typical quantities per 100 m³ (from the SAMPLE estimating guide in the knowledge base).
const RATIOS: Record<string, Record<string, number>> = {
  tube_coupler: { "TB-640": 38, "TB-300": 22, "CP-DBL": 210, "CP-SWV": 60, "CP-SLV": 20, "BD-390": 44, "BD-TOE": 18, "BP-STD": 12 },
  cantilever: { "TB-640": 46, "TB-300": 26, "CP-DBL": 260, "CP-SWV": 80, "CP-SLV": 30, "BD-390": 40, "BD-TOE": 18 },
  suspended: { "TB-640": 42, "TB-300": 30, "CP-DBL": 240, "CP-SWV": 70, "CP-SLV": 25, "BD-390": 40, "BD-TOE": 18 },
  birdcage: { "TB-640": 30, "TB-400": 25, "CP-DBL": 190, "CP-SWV": 30, "BD-390": 30, "BD-TOE": 6, "BP-STD": 16 },
  system_cuplock: { "CL-STD3": 30, "CL-LED25": 45, "CL-TRN13": 30, "BD-390": 44, "BD-TOE": 18, "BP-STD": 12, "TB-640": 6, "CP-SWV": 24 },
  system_ringlock: { "RL-STD3": 30, "CL-LED25": 40, "CL-TRN13": 28, "BD-390": 44, "BD-TOE": 18, "BP-STD": 12, "TB-640": 6, "CP-SWV": 24 },
  mobile_tower: { "CL-STD3": 40, "CL-LED25": 40, "CL-TRN13": 30, "BD-390": 30, "BD-TOE": 12, "BP-STD": 8 },
};

export type TakeoffLine = { sku: string; name: string; qty: number; weight_kg: number; available: number; shortfall: number };
export type Takeoff = { lines: TakeoffLine[]; total_weight_kg: number; truck_trips: number; volume_m3: number; shortages: string[] };

export const itemVolume = (i: ScopeItem) => Math.max(20, i.length_m * i.width_m * i.height_m) * i.quantity;

export async function takeoff(orgId: string, scope: Scope): Promise<Takeoff> {
  const qty: Record<string, number> = {};
  let volume = 0;
  for (const it of scope.items) {
    const v = itemVolume(it);
    volume += v;
    if (it.scaffold_type === "mast_climber") { qty["MC-UNIT"] = (qty["MC-UNIT"] ?? 0) + it.quantity; continue; }
    if (it.scaffold_type === "hoist") { qty["HS-2T"] = (qty["HS-2T"] ?? 0) + it.quantity; continue; }
    const r = RATIOS[it.scaffold_type] ?? RATIOS.tube_coupler;
    const factor = (v / 100) * (it.complex ? 1.15 : 1) * (it.duty === "heavy" ? 1.2 : it.duty === "light" ? 0.9 : 1);
    for (const [sku, per] of Object.entries(r)) qty[sku] = (qty[sku] ?? 0) + per * factor;
    // Access: a ladder per scaffold above 4 m (stair tower above 20 m).
    if (it.height_m > 20) qty["AC-STR"] = (qty["AC-STR"] ?? 0) + Math.ceil(it.height_m / 2) * it.quantity;
    else if (it.height_m > 4) qty["AC-LAD"] = (qty["AC-LAD"] ?? 0) + Math.ceil(it.height_m / 6) * it.quantity;
  }
  const items = await withSystem((db) =>
    rows<{ sku: string; name: string; weight_kg: string; available: string }>(db,
      `select i.sku, i.name, i.weight_kg, coalesce(sum(s.qty - s.reserved) filter (where l.kind = 'yard'), 0) available
       from items i left join stock s on s.item_id = i.id left join locations l on l.id = s.location_id
       where i.org_id = $1 and i.sku = any($2) group by i.id`, [orgId, Object.keys(qty)]),
  );
  const lines: TakeoffLine[] = Object.entries(qty).map(([sku, q]) => {
    const it = items.find((x) => x.sku === sku);
    const n = Math.ceil(q);
    const available = Number(it?.available ?? 0);
    return { sku, name: it?.name ?? sku, qty: n, weight_kg: Math.round(n * Number(it?.weight_kg ?? 0)), available, shortfall: Math.max(0, n - available) };
  });
  const total = lines.reduce((a, l) => a + l.weight_kg, 0);
  return {
    lines: lines.sort((a, b) => b.weight_kg - a.weight_kg),
    total_weight_kg: total,
    truck_trips: Math.max(1, Math.ceil(total / 20000)), // 22 t flatbed, keep 2 t margin
    volume_m3: Math.round(volume),
    shortages: lines.filter((l) => l.shortfall > 0).map((l) => `${l.sku} short by ${l.shortfall}`),
  };
}

export type Rate = { id: string; code: string; description: string; description_ar: string | null; unit: string; rate: number };
export type PricedLine = { rate_item_id: string | null; code: string; description: string; description_ar: string; qty: number; unit: string; rate: number; amount: number };
export type Priced = { lines: PricedLine[]; subtotal: number; vat: number; total: number };

export async function activeRates(orgId: string): Promise<Rate[]> {
  const r = await withSystem((db) =>
    rows<Rate & { rate: string }>(db, `select ri.id, ri.code, ri.description, ri.description_ar, ri.unit, ri.rate from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id where rc.org_id = $1 and rc.active`, [orgId]),
  );
  return r.map((x) => ({ ...x, rate: Number(x.rate) }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function price(scope: Scope, to: Pick<Takeoff, "truck_trips">, rates: Rate[]): Priced {
  const lines: PricedLine[] = [];
  const add = (code: string, qty: number, label?: string) => {
    const r = rates.find((x) => x.code === code);
    if (!r || qty <= 0) return;
    lines.push({ rate_item_id: r.id, code, description: label ? `${r.description} · ${label}` : r.description, description_ar: label ? `${r.description_ar ?? r.description} · ${label}` : r.description_ar ?? r.description, qty: round2(qty), unit: r.unit, rate: r.rate, amount: round2(qty * r.rate) });
  };
  let scaffoldCount = 0;
  for (const it of scope.items) {
    const label = it.description.slice(0, 60);
    if (it.scaffold_type === "mast_climber") { add("RNT-MC", it.quantity * Math.max(1, Math.ceil(scope.hire_weeks / 4.33)), label); add("LAB-SUP", 4 * it.quantity, label); continue; }
    if (it.scaffold_type === "hoist") { add("RNT-HST", it.quantity * Math.max(1, Math.ceil(scope.hire_weeks / 4.33)), label); continue; }
    const sys = it.scaffold_type.startsWith("system") || it.scaffold_type === "mobile_tower";
    const v = itemVolume(it) * (it.complex ? 1.15 : 1);
    add(sys ? "ERC-SYS" : "ERC-TC", v, label);
    add(sys ? "DSM-SYS" : "DSM-TC", v, label);
    add("RNT-M3W", v * scope.hire_weeks, label);
    if (["cantilever", "suspended"].includes(it.scaffold_type) || it.height_m > 20 || it.duty === "heavy") add("DES-CALC", it.quantity, label);
    scaffoldCount += it.quantity;
  }
  if (scaffoldCount) add("INS-7D", scaffoldCount * scope.hire_weeks);
  // Delivery and return trips.
  add(scope.offshore ? "MOB-OFF" : "MOB-ON", Math.max(2, to.truck_trips * 2));
  const labour = lines.filter((l) => /^(ERC|DSM)/.test(l.code)).reduce((a, l) => a + l.amount, 0);
  for (const [cond, code] of [[scope.offshore, "UPL-OFF"], [scope.night_work, "UPL-NIGHT"]] as const) {
    const r = rates.find((x) => x.code === code);
    if (cond && r && labour > 0) lines.push({ rate_item_id: r.id, code, description: `${r.description} (${r.rate}% of erection & dismantle)`, description_ar: `${r.description_ar ?? r.description} (${r.rate}%)`, qty: 1, unit: "lot", rate: round2((labour * r.rate) / 100), amount: round2((labour * r.rate) / 100) });
  }
  const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const vat = round2(subtotal * 0.15);
  return { lines, subtotal, vat, total: round2(subtotal + vat) };
}
