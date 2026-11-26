import Link from "next/link";
import { fmtDate, fmtSAR, type Loc } from "@/lib/format";
import type { Photo } from "@/lib/gallery";
import type { Area, ProjectSummary } from "@/lib/projects";
import { SERVICE_META, type ServiceLine } from "@/lib/service-lines";
import { health, ServiceChip, tx } from "../delivery/views";
import { Mono, Pill } from "../ui";

type Extras = { last_update: string | null; next_due: string | null; next_name: string | null; next_overdue: boolean; awaiting: number; rgs_pm: string | null; city: string | null; site_type: string | null; lat: number | null; lng: number | null };
type Cover = { url: string; kind: "illustration" | "photo"; caption: string } | undefined;

const TYPE: Record<string, [string, string]> = {
  offshore: ["Offshore", "بحري"], petrochemical: ["Industrial", "صناعي"], industrial: ["Industrial", "صناعي"], high_rise: ["Commercial / high-rise", "تجاري / أبراج"],
  marine: ["Marine", "بحري"], infrastructure: ["Infrastructure", "بنية تحتية"], entertainment: ["Entertainment", "ترفيه"],
};
export const siteTypeLabel = (t: string | null, l: Loc) => (t && TYPE[t] ? tx(l, ...TYPE[t]) : "");

/** Image with an honest badge: illustrations say so; real photos show who/when. */
export function ProjectImage({ url, kind, alt, className = "", badge = true, l }: { url: string; kind: "illustration" | "photo"; alt: string; className?: string; badge?: boolean; l: Loc }) {
  return (
    <div className={`relative overflow-hidden bg-line ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      {badge && <span className={`absolute bottom-2 end-2 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur ${kind === "illustration" ? "bg-ink/70" : "bg-tag-green/85"}`}>{kind === "illustration" ? tx(l, "Illustrative image", "صورة توضيحية") : tx(l, "Site photo", "صورة من الموقع")}</span>}
    </div>
  );
}

const STATUS: Record<string, [string, string, "green" | "brand" | "neutral"]> = { active: ["In execution", "قيد التنفيذ", "green"], mobilising: ["Mobilising", "قيد التجهيز", "brand"], completed: ["Completed", "مكتمل", "neutral"], on_hold: ["On hold", "متوقف", "neutral"] };

export function ProjectGrid({ list, covers, extras, base, l }: { list: ProjectSummary[]; covers: Record<string, Cover>; extras: Record<string, Extras>; base: string; l: Loc }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {list.map((p) => {
        const c = covers[p.id], e = extras[p.id], h = health(p), st = STATUS[p.status] ?? STATUS.active;
        const pct = Math.round(p.stage_pct);
        return (
          <Link key={p.id} href={`${base}/projects/${p.id}`} data-project={p.ref} className="group overflow-hidden rounded-2xl border border-line bg-panel transition hover:border-brand hover:shadow-md">
            {c ? <ProjectImage url={c.url} kind={c.kind} alt={c.caption} className="aspect-[16/7]" l={l} /> : <div className="aspect-[16/7] bg-canvas" />}
            <div className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center gap-1.5"><Mono>{p.ref}</Mono><Pill tone={st[2]}>{tx(l, st[0], st[1])}</Pill>{h.tone !== "green" ? <Pill tone={h.tone === "red" ? "red" : "yellow"}>{tx(l, h.en, h.ar)}</Pill> : <Pill tone="green">{tx(l, "On track", "في المسار")}</Pill>}</div>
              <div>
                <div className="text-lg font-semibold leading-snug">{l === "ar" && p.name_ar ? p.name_ar : p.name.split(" · ")[0]}</div>
                <div className="mt-0.5 flex items-center gap-1 text-sm text-muted"><svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>{e?.city ?? "—"}{e?.site_type ? ` · ${siteTypeLabel(e.site_type, l)}` : ""}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">{p.service_lines.map((x) => <ServiceChip key={x} line={x} l={l} />)}</div>
              <div>
                <div className="mb-1 flex justify-between text-sm"><span className="text-muted">{tx(l, "Progress", "التقدم")}</span><span className="font-semibold tabular">{pct}%</span></div>
                <div className="h-2 rounded-full bg-line"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
                <div><dt className="text-muted">{tx(l, "Last update", "آخر تحديث")}</dt><dd className="font-semibold">{e?.last_update ? fmtDate(e.last_update, l) : "—"}</dd></div>
                <div><dt className="text-muted">{tx(l, "Next committed date", "الموعد الملتزم التالي")}</dt><dd className={`font-semibold ${e?.next_overdue ? "text-tag-red" : ""}`}>{e?.next_due ? fmtDate(e.next_due, l) : "—"}</dd></div>
                <div><dt className="text-muted">{tx(l, "Next action owner", "المسؤول عن الإجراء التالي")}</dt><dd className="font-semibold">{e && e.awaiting > 0 ? tx(l, "Customer", "العميل") : `RGS · ${e?.rgs_pm ?? "—"}`}</dd></div>
                <div><dt className="text-muted">{tx(l, "Awaiting customer", "بانتظار العميل")}</dt><dd className="font-semibold tabular">{e?.awaiting ?? 0}</dd></div>
              </dl>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** Progress per service: stage-weighted, each service weighted by its share of the BOQ value ("% of effort"). */
export function servicePackages(areas: Area[]) {
  const total = areas.reduce((t, a) => t + a.boq_qty * a.rate, 0) || 1;
  const lines = [...new Set(areas.map((a) => a.service_line))];
  return lines.map((line) => {
    const mine = areas.filter((a) => a.service_line === line);
    const v = mine.reduce((t, a) => t + a.boq_qty * a.rate, 0);
    const pct = v ? mine.reduce((t, a) => t + a.stage_pct * a.boq_qty * a.rate, 0) / v : 0;
    return { line, pct: Math.round(pct), weight: Math.round((v / total) * 100), value: v, areas: mine.length, done: mine.filter((a) => a.status === "complete").length };
  });
}

export function PackageRows({ areas, l }: { areas: Area[]; l: Loc }) {
  return (
    <ul className="grid gap-2">
      {servicePackages(areas).map((x) => (
        <li key={x.line} className="grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem] items-center gap-3 text-sm">
          <span><ServiceChip line={x.line} l={l} /></span>
          <span className="text-end font-semibold tabular">{x.pct}%</span>
          <span className="text-xs text-muted tabular">{x.weight}% {tx(l, "of effort", "من الجهد")}</span>
        </li>
      ))}
    </ul>
  );
}

/** Schematic site layout: each area is a block (or tank / rack) tinted by its service, filled by progress. */
export function SiteLayout({ areas, openFindings, l, href }: { areas: Area[]; openFindings: Record<string, number>; l: Loc; href?: (a: Area) => string }) {
  const placed = areas.filter((a) => a.layout);
  const H = Math.max(60, ...placed.map((a) => a.layout!.y + a.layout!.h + 6));
  return (
    <div>
      <svg viewBox={`0 0 100 ${H}`} className="w-full rounded-lg border border-line bg-canvas" role="img" aria-label={tx(l, "Schematic site layout", "مخطط الموقع")}>
        <defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="var(--color-line)" strokeWidth=".15" /></pattern></defs>
        <rect width="100" height={H} fill="url(#grid)" />
        {placed.map((a) => {
          const { x, y, w, h, shape } = a.layout!;
          const c = SERVICE_META[a.service_line as ServiceLine]?.accent ?? "#888";
          const pct = Math.round(a.stage_pct);
          const n = openFindings[a.id] ?? 0;
          const body = shape === "tank"
            ? <><circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill={`${c}22`} stroke={c} strokeWidth=".5" /><path d={`M${x + w / 2 - Math.min(w, h) / 2} ${y + h / 2} A ${Math.min(w, h) / 2} ${Math.min(w, h) / 2} 0 0 0 ${x + w / 2 + Math.min(w, h) / 2} ${y + h / 2}`} fill={`${c}55`} opacity={pct / 100} /></>
            : <><rect x={x} y={y} width={w} height={h} rx="1.2" fill={`${c}1f`} stroke={c} strokeWidth=".5" /><rect x={x} y={y + h - 1.6} width={(w * pct) / 100} height="1.6" rx=".6" fill={c} /></>;
          const g = (
            <g key={a.id} data-area={a.code}>
              {body}
              {shape === "tank" ? <>
                <text x={x + w / 2} y={y + h / 2 - 0.4} fontSize="2.4" fontWeight="600" textAnchor="middle" fill="var(--color-ink)">{a.code}</text>
                <text x={x + w / 2} y={y + h / 2 + 2.8} fontSize="2.4" fontWeight="700" textAnchor="middle" fill={c}>{pct}%</text>
                <text x={x + w / 2} y={y + h + 2.6} fontSize="2" textAnchor="middle" fill="var(--color-muted)">{(l === "ar" && a.name_ar ? a.name_ar : a.name).slice(0, 24)}</text>
              </> : <>
                <text x={x + 1.4} y={y + 3.6} fontSize="2.4" fontWeight="600" fill="var(--color-ink)">{a.code}</text>
                <text x={x + 1.4} y={y + 6.6} fontSize="2" fill="var(--color-muted)">{(l === "ar" && a.name_ar ? a.name_ar : a.name).slice(0, Math.max(10, Math.floor(w * 0.9)))}</text>
                <text x={x + w - 1.4} y={y + 3.6} fontSize="2.4" fontWeight="700" textAnchor="end" fill={c}>{pct}%</text>
              </>}
              {n > 0 && <g><circle cx={x + w - 2.4} cy={y + h - 4.6} r="2" fill="var(--color-tag-red)" /><text x={x + w - 2.4} y={y + h - 3.9} fontSize="2.2" fontWeight="700" textAnchor="middle" fill="#fff">{n}</text></g>}
            </g>
          );
          return href ? <a key={a.id} href={href(a)}>{g}</a> : g;
        })}
        <text x="96" y="5" fontSize="2.6" textAnchor="end" fill="var(--color-muted)">N ↑</text>
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        {[...new Set(areas.map((a) => a.service_line))].map((x) => <ServiceChip key={x} line={x} l={l} />)}
        <span className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-full bg-tag-red" /> {tx(l, "Open corrective actions", "إجراءات تصحيحية مفتوحة")}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{tx(l, "Schematic layout for orientation only; not to scale.", "مخطط توضيحي للتوجيه فقط؛ ليس بمقياس رسم.")}</p>
    </div>
  );
}

const STAGE: Record<string, [string, string]> = { before: ["Before", "قبل"], during: ["During", "أثناء"], after: ["After", "بعد"] };
export const stageLabel = (s: string | null, l: Loc) => (s && STAGE[s] ? tx(l, ...STAGE[s]) : "");

export function PhotoCard({ ph, l, children }: { ph: Photo; l: Loc; children?: React.ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-panel" data-photo={ph.kind}>
      <a href={ph.url} target="_blank" rel="noreferrer"><ProjectImage url={ph.url} kind={ph.kind} alt={ph.caption} className="aspect-[16/10]" l={l} /></a>
      <figcaption className="grid gap-1 p-3 text-sm">
        <span className="font-medium leading-snug">{l === "ar" && ph.caption_ar ? ph.caption_ar : ph.caption}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {ph.service_line && <ServiceChip line={ph.service_line} l={l} />}{ph.stage && <Pill>{stageLabel(ph.stage, l)}</Pill>}{ph.area_code && <Mono>{ph.area_code}</Mono>}
          {ph.taken_on && <span>{fmtDate(ph.taken_on, l)}</span>}{!ph.visible_to_client && <Pill tone="yellow">{tx(l, "RGS only", "داخلي")}</Pill>}
        </span>
        {ph.credit && <span className="text-[11px] text-muted">{ph.credit}</span>}
        {children}
      </figcaption>
    </figure>
  );
}

/** Before / after pair for one area, side by side. */
export function BeforeAfter({ before, after, l }: { before: Photo; after: Photo; l: Loc }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[before, after].map((p, i) => (
        <div key={p.id} className="relative"><ProjectImage url={p.url} kind={p.kind} alt={p.caption} className="aspect-[16/10] rounded-lg" l={l} badge={i === 1} />
          <span className="absolute start-2 top-2 rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold">{i === 0 ? tx(l, "Before", "قبل") : tx(l, "After", "بعد")}</span></div>
      ))}
    </div>
  );
}

// ───────────────────────── Map of the Kingdom ─────────────────────────
// Simplified outline of Saudi Arabia (lon, lat), for orientation only.
const KSA: [number, number][] = [
  [34.95, 29.36], [36.07, 29.19], [36.5, 29.5], [37.0, 31.5], [39.2, 32.15], [40.4, 31.95], [42.0, 31.1], [44.7, 29.2], [46.55, 29.1], [47.7, 28.53], [48.42, 28.55],
  [48.8, 27.7], [49.3, 27.2], [49.67, 27.0], [50.15, 26.65], [50.2, 26.2], [50.5, 25.6], [50.8, 24.75], [51.6, 24.25], [52.6, 22.95], [55.1, 22.62], [55.67, 22.0],
  [55.0, 20.0], [52.0, 19.0], [49.1, 18.6], [48.2, 18.2], [47.4, 17.1], [46.4, 17.25], [44.6, 17.42], [43.3, 17.55], [43.0, 16.7], [42.8, 16.4], [42.55, 16.9],
  [41.8, 17.9], [41.2, 18.8], [40.8, 19.6], [39.7, 20.8], [39.17, 21.5], [39.0, 22.4], [38.95, 22.9], [38.5, 23.6], [38.06, 24.09], [37.3, 25.0], [36.6, 25.9], [35.6, 27.3], [35.15, 28.05], [34.6, 28.1], [34.95, 29.36],
];
const LON0 = 34, LON1 = 56.5, LAT0 = 15.8, LAT1 = 32.5, MW = 1000, MH = Math.round(((LAT1 - LAT0) / (LON1 - LON0)) * MW * 1.05);
const px = (lon: number, lat: number) => [((lon - LON0) / (LON1 - LON0)) * MW, ((LAT1 - lat) / (LAT1 - LAT0)) * MH] as const;
const CITIES: [string, string, number, number][] = [["Jubail", "الجبيل", 49.66, 27.0], ["Dammam", "الدمام", 50.1, 26.43], ["Riyadh", "الرياض", 46.7, 24.7], ["Jeddah", "جدة", 39.17, 21.54], ["Makkah", "مكة المكرمة", 39.83, 21.42], ["Madinah", "المدينة المنورة", 39.6, 24.47], ["Tabuk", "تبوك", 36.57, 28.38], ["Abha", "أبها", 42.5, 18.22]];

export function KsaMap({ pins, selected, base, l }: { pins: { city: string; count: number; lat: number; lng: number; lines: string[] }[]; selected?: string; base: string; l: Loc }) {
  const outline = KSA.map(([a, b]) => px(a, b).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${MW} ${MH}`} className="w-full" role="img" aria-label={tx(l, "Map of RGS projects in Saudi Arabia", "خريطة مشاريع RGS في المملكة")}>
      <rect width={MW} height={MH} fill="#dbeaf3" />
      <polygon points={outline} fill="#f3ead8" stroke="#c9b48c" strokeWidth="2" />
      {CITIES.filter(([en]) => !pins.some((p) => p.city === en)).map(([en, ar, lon, lat]) => { const [x, y] = px(lon, lat); return <g key={en}><circle cx={x} cy={y} r="3.5" fill="#9b8a6a" /><text x={x + 7} y={y + 4} fontSize="15" fill="#8b7a5a">{l === "ar" ? ar : en}</text></g>; })}
      <text x={px(51.3, 26.9)[0]} y={px(51.3, 26.9)[1]} fontSize="16" fill="#6a8ea3" fontStyle="italic">{tx(l, "Arabian Gulf", "الخليج العربي")}</text>
      <text x={px(37.2, 22.4)[0]} y={px(37.2, 22.4)[1]} fontSize="16" fill="#6a8ea3" fontStyle="italic">{tx(l, "Red Sea", "البحر الأحمر")}</text>
      {pins.map((p) => {
        const [x, y] = px(p.lng, p.lat);
        const on = selected === p.city;
        const cityAr = CITIES.find(([en]) => en === p.city)?.[1];
        // Keep neighbouring labels apart (Jeddah/Makkah, Jubail/Khobar).
        const left = ["Jeddah", "Jubail", "Rabigh"].includes(p.city), below = ["Makkah", "Khobar"].includes(p.city);
        return (
          <a key={p.city} href={`${base}/map?city=${encodeURIComponent(p.city)}`} data-pin={p.city}>
            <circle cx={x} cy={y} r={on ? 22 : 16 + Math.min(8, p.count * 2)} fill="#f9441a" opacity={on ? 0.35 : 0.2} />
            <circle cx={x} cy={y} r={on ? 12 : 10} fill="#f9441a" stroke="#fff" strokeWidth="3" />
            <text x={x} y={y + 5} fontSize="13" fontWeight="700" textAnchor="middle" fill="#fff">{p.count}</text>
            <text x={left ? x - 18 : x + 18} y={y + (below ? 30 : -10)} textAnchor={left ? "end" : "start"} fontSize="18" fontWeight="700" fill="#141922" stroke="#f3ead8" strokeWidth="4" paintOrder="stroke">{l === "ar" && cityAr ? cityAr : p.city}</text>
          </a>
        );
      })}
    </svg>
  );
}

export function money(v: number, l: Loc) { return fmtSAR(v, l); }
