/*
 * Generates the illustrated scene artwork used as placeholder project imagery (public/gallery/*.svg).
 * These are drawings, clearly badged "Illustrative image" in the UI, never presented as RGS site photos.
 * Replace them with real photos through the project gallery upload.
 *   npx tsx scripts/gen-illustrations.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1200, H = 750;
type Pal = { sky1: string; sky2: string; sun: string; ground: string; ground2: string; haze: string; metal: string; metal2: string; shadow: string };
const PAL: Record<string, Pal> = {
  day: { sky1: "#7fb8e6", sky2: "#d9ecf7", sun: "#fff6d5", ground: "#d8c39a", ground2: "#c4ab7c", haze: "#f3e6cc", metal: "#8f9aa6", metal2: "#5f6b78", shadow: "#00000022" },
  dusk: { sky1: "#f08a4b", sky2: "#fbd39a", sun: "#fff1c9", ground: "#b99266", ground2: "#9b7650", haze: "#f6c28a", metal: "#6f6a72", metal2: "#45414a", shadow: "#00000033" },
  morning: { sky1: "#9cc6e8", sky2: "#f6e2c4", sun: "#fff3d6", ground: "#dcc8a0", ground2: "#c9ae80", haze: "#f8e7cd", metal: "#97a1ab", metal2: "#66717c", shadow: "#00000020" },
};
const ORANGE = "#f9441a";
let uid = 0;

const base = (p: Pal, sunX = 950, sunY = 150) => `
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky1}"/><stop offset="1" stop-color="${p.sky2}"/></linearGradient>
    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.ground}"/><stop offset="1" stop-color="${p.ground2}"/></linearGradient>
    <radialGradient id="sun"><stop offset="0" stop-color="${p.sun}"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient>
    <linearGradient id="pipe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9edf1"/><stop offset=".5" stop-color="#b9c2cb"/><stop offset="1" stop-color="#7d8894"/></linearGradient>
    <linearGradient id="clad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".45" stop-color="#cfd6dd"/><stop offset="1" stop-color="#8c97a3"/></linearGradient>
    <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.metal2}"/><stop offset=".5" stop-color="${p.metal}"/><stop offset="1" stop-color="${p.metal2}"/></linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f86a8"/><stop offset="1" stop-color="#1d4f6b"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="${sunX}" cy="${sunY}" r="160" fill="url(#sun)"/><circle cx="${sunX}" cy="${sunY}" r="38" fill="${p.sun}"/>`;

const ground = (p: Pal, y = 560) => `<rect y="${y}" width="${W}" height="${H - y}" fill="url(#gr)"/><rect y="${y}" width="${W}" height="14" fill="${p.haze}" opacity=".6"/>`;
const hazeBand = (p: Pal, y: number) => `<rect y="${y - 40}" width="${W}" height="80" fill="${p.haze}" opacity=".35"/>`;

/** Tube-and-coupler style scaffold: standards, ledgers, diagonal braces, boards, toe boards, ladder. */
function scaffold(x: number, y: number, bays: number, lifts: number, bw = 70, lh = 60, opts: { boards?: boolean; tone?: string } = {}) {
  const t = opts.tone ?? "#c9ced4";
  let s = `<g stroke="${t}" stroke-width="4" stroke-linecap="round">`;
  for (let i = 0; i <= bays; i++) s += `<line x1="${x + i * bw}" y1="${y}" x2="${x + i * bw}" y2="${y - lifts * lh - 20}"/>`;
  for (let j = 0; j <= lifts; j++) s += `<line x1="${x - 6}" y1="${y - j * lh}" x2="${x + bays * bw + 6}" y2="${y - j * lh}"/>`;
  s += `</g><g stroke="${t}" stroke-width="2.5" opacity=".9">`;
  for (let i = 0; i < bays; i += 2) for (let j = 0; j < lifts; j++) s += `<line x1="${x + i * bw}" y1="${y - j * lh}" x2="${x + (i + 1) * bw}" y2="${y - (j + 1) * lh}"/>`;
  s += `</g>`;
  if (opts.boards !== false) for (let j = 1; j <= lifts; j++) s += `<rect x="${x}" y="${y - j * lh - 4}" width="${bays * bw}" height="7" fill="#b07a3c"/><rect x="${x}" y="${y - j * lh - 16}" width="${bays * bw}" height="4" fill="#e8c21a" opacity=".85"/>`;
  // ladder
  const lx = x + bw * Math.max(0, bays - 1) + bw * 0.55;
  s += `<g stroke="#e8c21a" stroke-width="2.5"><line x1="${lx}" y1="${y}" x2="${lx}" y2="${y - lh * Math.min(lifts, 3)}"/><line x1="${lx + 14}" y1="${y}" x2="${lx + 14}" y2="${y - lh * Math.min(lifts, 3)}"/>`;
  for (let k = 8; k < lh * Math.min(lifts, 3); k += 12) s += `<line x1="${lx}" y1="${y - k}" x2="${lx + 14}" y2="${y - k}"/>`;
  // scaffold tag
  s += `</g><rect x="${x + 6}" y="${y - lh + 10}" width="16" height="22" rx="2" fill="#16a34a" stroke="#fff" stroke-width="1.5"/>`;
  return s;
}

/** Worker in orange coveralls and white helmet. */
function worker(x: number, y: number, sc = 1, pose: "stand" | "reach" | "kneel" = "stand", flip = false) {
  const id = `w${uid++}`;
  const f = flip ? -1 : 1;
  const arm = pose === "reach" ? `<path d="M2 -40 L${16 * f} -64" stroke="${ORANGE}" stroke-width="7" stroke-linecap="round"/>` : `<path d="M2 -40 L${10 * f} -18" stroke="${ORANGE}" stroke-width="7" stroke-linecap="round"/>`;
  const legs = pose === "kneel" ? `<path d="M-4 -18 L-14 0 M5 -18 L14 -4 L24 -4" stroke="#1f2a37" stroke-width="7" stroke-linecap="round" fill="none"/>` : `<path d="M-4 -18 L-7 0 M5 -18 L8 0" stroke="#1f2a37" stroke-width="7" stroke-linecap="round"/>`;
  return `<g id="${id}" transform="translate(${x} ${y}) scale(${sc})">${legs}<rect x="-10" y="-50" width="22" height="34" rx="6" fill="${ORANGE}"/><rect x="-10" y="-36" width="22" height="4" fill="#e5e7eb" opacity=".9"/><rect x="-10" y="-24" width="22" height="3" fill="#e5e7eb" opacity=".9"/>${arm}<circle cx="1" cy="-58" r="8" fill="#c68b5d"/><path d="M-9 -60 Q1 -74 11 -60 Z" fill="#fafafa"/><rect x="-11" y="-61" width="24" height="3" rx="1" fill="#fafafa"/></g>`;
}

function column(x: number, y: number, w: number, h: number) {
  return `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="url(#pipe)"/><ellipse cx="${x + w / 2}" cy="${y - h}" rx="${w / 2}" ry="8" fill="#dfe4e9"/>` +
    Array.from({ length: Math.floor(h / 70) }, (_, i) => `<rect x="${x - 6}" y="${y - h + 40 + i * 70}" width="${w + 12}" height="5" fill="#7b8691"/>`).join("");
}

function pipeRack(x: number, y: number, len: number, levels = 3, cladded = 0.5) {
  let s = "";
  for (let i = 0; i <= len; i += 120) s += `<rect x="${x + i}" y="${y - levels * 55 - 10}" width="10" height="${levels * 55 + 10}" fill="url(#steel)"/>`;
  for (let j = 1; j <= levels; j++) {
    s += `<rect x="${x - 10}" y="${y - j * 55}" width="${len + 30}" height="8" fill="#6b7682"/>`;
    for (let k = 0; k < 4; k++) {
      const py = y - j * 55 - 12 - k * 0; const px = x + k * 0;
      const cl = (k / 4) < cladded;
      s += `<rect x="${px - 10}" y="${py - 8 - k * 9}" width="${len + 30}" height="${cl ? 14 : 9}" rx="4" fill="${cl ? "url(#clad)" : "url(#pipe)"}" opacity="${cl ? 1 : 0.95}"/>`;
      if (cl) for (let b = x; b < x + len; b += 46) s += `<line x1="${b}" y1="${py - 8 - k * 9}" x2="${b}" y2="${py + 6 - k * 9}" stroke="#9aa5b0" stroke-width="1.2"/>`;
    }
  }
  return s;
}

function tank(cx: number, y: number, r: number, h: number, cladFrac = 0.6) {
  const top = y - h;
  let s = `<rect x="${cx - r}" y="${top}" width="${2 * r}" height="${h}" fill="url(#clad)"/><ellipse cx="${cx}" cy="${top}" rx="${r}" ry="${r * 0.18}" fill="#e7ebef"/>`;
  for (let yy = top + 30; yy < y; yy += 34) s += `<path d="M${cx - r} ${yy} Q${cx} ${yy + r * 0.06} ${cx + r} ${yy}" stroke="#a7b1bb" stroke-width="1.4" fill="none"/>`;
  // uncladded lower part (bare steel, primer red-brown)
  const bare = h * (1 - cladFrac);
  s += `<rect x="${cx - r}" y="${y - bare}" width="${2 * r}" height="${bare}" fill="#9b5a3c"/><rect x="${cx - r}" y="${y - bare}" width="${2 * r}" height="6" fill="#6b3b27"/>`;
  return s;
}

function building(x: number, y: number, w: number, h: number, tone = "#e9e1d4", win = "#7fa6c4") {
  let s = `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="${tone}"/>`;
  for (let yy = y - h + 18; yy < y - 20; yy += 30) for (let xx = x + 12; xx < x + w - 18; xx += 26) s += `<rect x="${xx}" y="${yy}" width="14" height="18" fill="${win}" opacity=".85"/>`;
  return s;
}

function flare(x: number, y: number, h: number) {
  return `<rect x="${x}" y="${y - h}" width="10" height="${h}" fill="url(#steel)"/><path d="M${x + 5} ${y - h - 4} q-14 -30 2 -60 q4 22 14 30 q6 -18 -2 -34 q22 26 6 64 z" fill="#ffb02e"/><path d="M${x + 5} ${y - h - 4} q-6 -18 2 -34 q6 14 6 34 z" fill="#fff1a8"/>`;
}

const svg = (body: string, title: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} (illustration)"><title>${title} (illustration)</title>${body}</svg>`;

const scenes: Record<string, (pal?: Pal) => string> = {
  // Process plant turnaround: columns wrapped in scaffold, crew on the lifts.
  "plant-scaffold": (pal) => { const p = pal ?? PAL.day; return svg(base(p, 1000, 120) + hazeBand(p, 470) +
    building(40, 560, 120, 140, "#cfc6b6") + column(140, 560, 70, 380) + column(260, 560, 90, 300) + column(820, 560, 60, 420) + column(940, 560, 80, 260) + flare(1100, 560, 330) +
    pipeRack(380, 560, 380, 2, 0.3) + ground(p) +
    scaffold(110, 560, 3, 6, 50, 55) + scaffold(780, 560, 3, 7, 50, 55) +
    worker(170, 450, 1.05, "reach") + worker(230, 340, 1, "stand", true) + worker(840, 395, 1, "reach") + worker(880, 285, 0.95, "stand", true) + worker(520, 600, 1.15, "stand") + worker(560, 602, 1.15, "kneel", true), "Process plant turnaround scaffolding"); },
  // Pipe rack: hot insulation and aluminium cladding going on.
  "pipe-rack-insulation": (pal) => { const p = pal ?? PAL.morning; return svg(base(p, 220, 140) + hazeBand(p, 470) + column(1000, 560, 70, 300) + column(1100, 560, 50, 220) +
    pipeRack(60, 560, 900, 3, 0.55) + ground(p) + scaffold(500, 560, 4, 3, 60, 55) +
    worker(560, 450, 1, "reach") + worker(650, 395, 1, "reach", true) + worker(300, 610, 1.15, "stand") + `<rect x="330" y="585" width="80" height="26" fill="#d9dee3" stroke="#9aa5b0"/><rect x="340" y="575" width="60" height="12" fill="#f2c14e"/>`, "Pipe rack hot insulation and cladding"); },
  // Storage tank insulation with scaffold up one side.
  "tank-insulation": (pal) => { const p = pal ?? PAL.day; return svg(base(p, 980, 130) + hazeBand(p, 480) + tank(300, 560, 210, 300, 0.7) + tank(820, 560, 170, 240, 0.4) + ground(p) +
    scaffold(610, 560, 3, 5, 55, 50) + worker(660, 460, 1, "reach") + worker(720, 360, 0.95, "reach", true) + worker(160, 610, 1.15, "stand"), "Storage tank thermal insulation"); },
  // Roof waterproofing and heat-proofing: membrane rolls, white reflective coat.
  "roof-waterproofing": (pal) => { const p = pal ?? PAL.day; return svg(base(p, 980, 110) + building(80, 760, 260, 420, "#e3d8c6") + building(880, 760, 240, 470, "#ddd2c0") +
    `<polygon points="0,520 1200,470 1200,750 0,750" fill="#8b8f93"/><polygon points="0,560 700,523 700,750 0,750" fill="#f4f5f2"/><polygon points="700,523 1200,497 1200,750 700,750" fill="#3a3d40"/>` +
    Array.from({ length: 7 }, (_, i) => `<line x1="${i * 100}" y1="${560 - i * 5.3}" x2="${i * 100 + 40}" y2="750" stroke="#dcdcd6" stroke-width="2"/>`).join("") +
    `<g><rect x="760" y="600" width="140" height="34" rx="17" fill="#2b2e31"/><ellipse cx="900" cy="617" rx="12" ry="17" fill="#55595e"/><rect x="930" y="640" width="120" height="30" rx="15" fill="#2b2e31"/><ellipse cx="1050" cy="655" rx="10" ry="15" fill="#55595e"/></g>` +
    `<rect x="560" y="640" width="46" height="56" rx="6" fill="#e9eef2" stroke="#9aa5b0"/><rect x="566" y="630" width="34" height="12" fill="#7f8b96"/>` +
    worker(640, 680, 1.4, "kneel") + worker(470, 690, 1.4, "stand", true) + worker(980, 610, 1.2, "kneel", true) + `<path d="M500 690 l120 -6" stroke="#cfd3d6" stroke-width="5"/>`, "Roof waterproofing and heat-reflective coating"); },
  // Basement / tank waterproofing: excavation wall with membrane and protection board.
  "basement-waterproofing": (pal) => { const p = pal ?? PAL.morning; return svg(base(p, 1020, 120) + building(700, 380, 420, 180, "#cbbfae") +
    `<polygon points="0,380 1200,380 1200,750 0,750" fill="#b49a73"/><rect x="120" y="380" width="960" height="370" fill="#8f7a5c"/><rect x="160" y="400" width="880" height="350" fill="#9d9a94"/>` +
    `<rect x="160" y="400" width="520" height="350" fill="#2f3235"/>` + Array.from({ length: 6 }, (_, i) => `<line x1="${160 + i * 88}" y1="400" x2="${160 + i * 88}" y2="750" stroke="#4a4e52" stroke-width="3"/>`).join("") +
    `<rect x="160" y="400" width="260" height="350" fill="#1f5a3d" opacity=".55"/>` +
    scaffold(560, 750, 3, 5, 60, 64) + worker(610, 620, 1.2, "reach") + worker(700, 560, 1.15, "reach", true) + worker(320, 745, 1.3, "stand"), "Basement wall waterproofing membrane"); },
  // High-rise façade with scaffold and mast climber.
  "tower-facade": (pal) => { const p = pal ?? PAL.dusk; return svg(base(p, 220, 200) + building(60, 600, 180, 300, "#c9b9a6", "#e9b98a") + building(930, 600, 220, 360, "#bfae9a", "#e9b98a") +
    `<rect x="420" y="70" width="360" height="530" fill="#d7cdbf"/>` + Array.from({ length: 16 }, (_, j) => Array.from({ length: 8 }, (_, i) => `<rect x="${436 + i * 43}" y="${90 + j * 31}" width="28" height="20" fill="#5f88a8" opacity=".8"/>`).join("")).join("") +
    scaffold(400, 600, 6, 9, 66, 58, { tone: "#d9dde1" }) + `<rect x="840" y="80" width="14" height="520" fill="#9aa3ad"/><rect x="800" y="300" width="120" height="16" fill="${ORANGE}"/>` +
    worker(470, 545, 0.9, "reach") + worker(600, 372, 0.85, "stand", true) + worker(700, 255, 0.85, "reach") + worker(850, 300, 0.85, "stand") + ground(p, 600), "High-rise façade access scaffold"); },
  // Offshore platform with scaffold under the deck.
  "offshore-platform": (pal) => { const p = pal ?? PAL.day; return svg(base(p, 1000, 120) + `<rect y="470" width="${W}" height="${H - 470}" fill="url(#sea)"/>` +
    Array.from({ length: 10 }, (_, i) => `<path d="M${i * 130} ${520 + (i % 3) * 40} q30 -8 60 0" stroke="#bfe0ef" stroke-width="2" fill="none" opacity=".6"/>`).join("") +
    `<g fill="url(#steel)"><rect x="330" y="300" width="18" height="380"/><rect x="560" y="300" width="18" height="380"/><rect x="790" y="300" width="18" height="380"/></g>` +
    `<g stroke="#5f6b78" stroke-width="6"><line x1="339" y1="420" x2="569" y2="560"/><line x1="569" y1="420" x2="339" y2="560"/><line x1="569" y1="420" x2="799" y2="560"/><line x1="799" y1="420" x2="569" y2="560"/></g>` +
    `<rect x="280" y="270" width="580" height="34" fill="#4d5966"/><rect x="300" y="170" width="200" height="100" fill="#e8e2d6"/><rect x="520" y="200" width="160" height="70" fill="#d9a441"/><rect x="700" y="120" width="40" height="150" fill="url(#pipe)"/>` + flare(820, 270, 150) +
    scaffold(380, 420, 5, 2, 60, 55, { tone: "#e1e5e9" }) + worker(430, 365, 0.85, "reach") + worker(560, 310, 0.85, "stand", true) + worker(400, 268, 0.85, "stand"), "Offshore platform under-deck scaffold"); },
  // Marine jetty pipe rack at sunset.
  "jetty-pipe-rack": (pal) => { const p = pal ?? PAL.dusk; return svg(base(p, 600, 300) + `<rect y="430" width="${W}" height="${H - 430}" fill="url(#sea)"/>` +
    `<polygon points="0,560 1200,520 1200,600 0,660" fill="#5a5f66"/>` + pipeRack(40, 560, 1080, 2, 0.4).replace(/y="(\d+)"/g, (m, v) => `y="${Number(v) - 10}"`) +
    scaffold(200, 560, 3, 3, 60, 55) + worker(240, 450, 1, "reach") + worker(320, 505, 1.05, "stand", true) + worker(700, 545, 1.1, "stand"), "Marine jetty pipe rack"); },
  // West-coast refinery (Rabigh / Yanbu style) with sea behind.
  "refinery-coast": (pal) => { const p = pal ?? PAL.morning; return svg(base(p, 240, 140) + `<rect y="430" width="${W}" height="70" fill="#4b93b4" opacity=".8"/>` + hazeBand(p, 470) +
    column(120, 560, 60, 320) + column(220, 560, 80, 260) + tank(470, 560, 120, 150, 0.8) + tank(720, 560, 120, 150, 0.5) + column(930, 560, 70, 360) + flare(1080, 560, 360) + ground(p) +
    scaffold(880, 560, 3, 6, 45, 55) + worker(920, 450, 0.95, "reach") + worker(980, 340, 0.9, "stand", true) + worker(620, 610, 1.15, "stand"), "Coastal refinery hot insulation"); },
  // Hotel towers with roof works (western region). Generic architecture; no landmarks.
  "hotel-roof": (pal) => { const p = pal ?? PAL.dusk; return svg(base(p, 980, 220) +
    `<path d="M0 470 L120 380 L240 440 L380 330 L520 430 L640 360 L800 450 L960 350 L1200 440 L1200 560 L0 560 Z" fill="#9c6f55" opacity=".85"/>` +
    building(80, 620, 220, 330, "#efe6d6", "#f2c88f") + building(330, 620, 280, 420, "#e8dcc8", "#f2c88f") + building(650, 620, 240, 360, "#f1e8da", "#f2c88f") + building(920, 620, 220, 300, "#e6dac6", "#f2c88f") +
    `<rect x="330" y="196" width="280" height="10" fill="#8b8f93"/>` + scaffold(350, 196, 4, 1, 60, 45, { boards: false }) + worker(420, 194, 0.8, "kneel") + worker(500, 194, 0.8, "stand", true) + worker(560, 194, 0.8, "reach") + ground(p, 620), "Hotel roof heat-proofing and waterproofing"); },
  // Villas: wet-area and roof waterproofing.
  "villa-waterproofing": (pal) => { const p = pal ?? PAL.day; return svg(base(p, 1000, 120) + ground(p, 520) +
    [80, 430, 780].map((x) => `<rect x="${x}" y="300" width="300" height="220" fill="#efe6d8"/><rect x="${x + 40}" y="360" width="60" height="70" fill="#7fa6c4"/><rect x="${x + 180}" y="360" width="60" height="70" fill="#7fa6c4"/><rect x="${x + 120}" y="430" width="50" height="90" fill="#8a6a4a"/><rect x="${x - 6}" y="290" width="312" height="14" fill="#d8cdbc"/>`).join("") +
    `<rect x="430" y="286" width="300" height="10" fill="#2f3235"/><rect x="430" y="286" width="150" height="10" fill="#f4f5f2"/>` +
    scaffold(440, 520, 4, 4, 70, 55) + worker(500, 285, 0.9, "kneel") + worker(640, 285, 0.9, "stand", true) + worker(260, 575, 1.15, "stand"), "Villa roof and wet-area waterproofing"); },
  // Fireproofing on structural steel.
  "fireproofing-steel": (pal) => { const p = pal ?? PAL.day; return svg(base(p, 1020, 120) + hazeBand(p, 470) + ground(p) +
    Array.from({ length: 6 }, (_, i) => `<rect x="${120 + i * 170}" y="180" width="26" height="380" fill="${i < 3 ? "#cfc9bf" : "url(#steel)"}"/>`).join("") +
    [260, 380, 480].map((y, j) => `<rect x="110" y="${y}" width="900" height="22" fill="${j === 0 ? "#cfc9bf" : "url(#steel)"}"/>`).join("") +
    scaffold(430, 560, 3, 6, 55, 55) + worker(480, 450, 1, "reach") + `<path d="M500 395 q30 -10 60 4" stroke="#e5e1d8" stroke-width="10" fill="none" opacity=".8"/>` + worker(540, 340, 0.95, "stand", true) + worker(820, 610, 1.15, "stand"), "Structural steel fireproofing"); },
};

const out = join(process.cwd(), "public", "gallery");
mkdirSync(out, { recursive: true });
const ALT: Record<string, Pal> = { day: PAL.dusk, morning: PAL.day, dusk: PAL.morning };
for (const [name, fn] of Object.entries(scenes)) {
  writeFileSync(join(out, `${name}.svg`), fn());
  // A second time-of-day so a gallery doesn't repeat the same picture.
  const src = fn.toString().match(/PAL\.(\w+)/)?.[1] ?? "day";
  writeFileSync(join(out, `${name}-alt.svg`), fn(ALT[src]));
  console.log("wrote", name);
}
