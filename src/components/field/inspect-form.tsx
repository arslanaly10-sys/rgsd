"use client";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CHECKLIST, rank, suggestTag, type Finding, type ItemResult, type TagStatus } from "@/lib/checklist";
import { downscale, outbox, postInspection } from "@/lib/client/outbox";

type Props = { tagNo: string; currentStatus: string; role: string; canFull: boolean };
type Photo = { name: string; data: string };

const TAG_STYLE: Record<TagStatus, string> = {
  green: "border-tag-green bg-tag-green-bg text-tag-green",
  yellow: "border-[#e0a300] bg-tag-yellow-bg text-tag-yellow",
  red: "border-tag-red bg-tag-red-bg text-tag-red",
};

export function InspectForm({ tagNo, currentStatus, canFull }: Props) {
  const t = useTranslations("field");
  const tt = useTranslations("tag");
  const ar = useLocale() === "ar";
  const [results, setResults] = useState<Record<string, ItemResult>>(() => Object.fromEntries(CHECKLIST.map((c) => [c.code, c.code === "HAR" ? "na" : "pass"])));
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [ai, setAi] = useState<{ findings: Finding[]; note?: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [type, setType] = useState(currentStatus === "erecting" ? "handover" : "periodic_7day");
  const [result, setResult] = useState<TagStatus | null>(null);
  const [restrictions, setRestrictions] = useState("");
  const [override, setOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const checklist = CHECKLIST.map((c) => ({ code: c.code, result: results[c.code], note: itemNotes[c.code] || undefined }));
  const suggestion = useMemo(() => suggestTag(checklist, ai?.findings ?? []), [results, ai]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = result ?? (canFull ? suggestion.status : "red");
  const needsOverride = rank[chosen] < rank[suggestion.status];

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const next: Photo[] = [];
    for (const f of Array.from(files).slice(0, 8 - photos.length)) next.push({ name: f.name, data: await downscale(f) });
    setPhotos((p) => [...p, ...next]);
    setAi(null);
  }

  async function runAi() {
    if (!navigator.onLine) { setMsg({ ok: false, text: t("aiOffline") }); return; }
    setAiBusy(true);
    try {
      const r = await fetch("/api/field/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tag_no: tagNo, checklist, photos }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAi({ findings: d.findings, note: d.note });
      setResult(null);
      if (d.suggestion.restrictions.length && !restrictions) setRestrictions((ar ? d.suggestion.restrictionsAr : d.suggestion.restrictions).join("; "));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || t("aiOffline") });
    } finally {
      setAiBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = {
      offline_id: crypto.randomUUID(), tag_no: tagNo, type, checklist, result: chosen,
      restrictions: chosen === "yellow" ? restrictions || (ar ? suggestion.restrictionsAr : suggestion.restrictions).join("; ") : undefined,
      notes: notes || undefined, override_reason: needsOverride ? override : undefined, photos, competent_person_confirmed: confirm, inspected_at: new Date().toISOString(),
    };
    setBusy(true);
    try {
      if (!navigator.onLine) throw new TypeError("offline");
      const r = await postInspection(payload);
      if (r.ok) setMsg({ ok: true, text: t("saved", { result: tt(r.data.result) }) });
      else if (r.status >= 500) { await outbox.add({ ...payload, queued_at: new Date().toISOString() }); setMsg({ ok: true, text: t("savedOffline") }); }
      else setMsg({ ok: false, text: r.data.error ?? "Error" });
    } catch {
      await outbox.add({ ...payload, queued_at: new Date().toISOString() });
      setMsg({ ok: true, text: t("savedOffline") });
    } finally {
      setBusy(false);
    }
  }

  const done = msg?.ok;
  return (
    <form onSubmit={submit} className="grid gap-5 p-4">
      <div className="grid gap-1">
        <label htmlFor="type" className="eyebrow">{t("type")}</label>
        <select id="type" value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl border border-line bg-panel px-3 py-3 text-base">
          {["periodic_7day", "handover", "after_weather", "after_modification", "ad_hoc"].map((k) => <option key={k} value={k}>{t(`types.${k}`)}</option>)}
        </select>
      </div>

      <section>
        <h2 className="eyebrow mb-2">{t("checklist")}</h2>
        <ul className="grid gap-2">
          {CHECKLIST.map((c) => (
            <li key={c.code} className={`rounded-xl border bg-panel p-3 ${results[c.code] === "fail" ? "border-tag-red" : "border-line"}`}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 font-mono text-[11px] text-muted">{c.code}</span>
                <span className="flex-1 text-sm">{ar ? c.ar : c.en}{c.weight === "critical" && <span className="ms-1 text-tag-red" aria-label="critical">●</span>}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={c.en}>
                {(["pass", "fail", "na"] as const).map((r) => (
                  <button type="button" key={r} role="radio" aria-checked={results[c.code] === r} onClick={() => { setResults((x) => ({ ...x, [c.code]: r })); setResult(null); }}
                    className={`rounded-lg py-2 text-sm font-semibold ${results[c.code] === r ? (r === "pass" ? "bg-tag-green text-white" : r === "fail" ? "bg-tag-red text-white" : "bg-ink text-white") : "bg-canvas text-muted"}`}>
                    {t(r)}
                  </button>
                ))}
              </div>
              {results[c.code] === "fail" && (
                <input aria-label={`${c.code} note`} value={itemNotes[c.code] ?? ""} onChange={(e) => setItemNotes((x) => ({ ...x, [c.code]: e.target.value }))} placeholder={ar ? "ما المشكلة وأين؟" : "What and where?"} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="eyebrow mb-2">{t("photos")} ({photos.length}/8)</h2>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <button type="button" key={i} onClick={() => { setPhotos((x) => x.filter((_, j) => j !== i)); setAi(null); }} className="relative aspect-square overflow-hidden rounded-lg border border-line" aria-label={`Remove ${p.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.data} alt={p.name} className="h-full w-full object-cover" />
              <span className="absolute end-1 top-1 rounded bg-ink/70 px-1 text-[10px] text-white">×</span>
            </button>
          ))}
          {photos.length < 8 && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line text-center text-[11px] text-muted">
              <span className="text-2xl leading-none">+</span>{t("addPhoto")}
              <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
            </label>
          )}
        </div>
        {photos.length > 0 && (
          <button type="button" onClick={runAi} disabled={aiBusy} className="mt-3 w-full rounded-xl border border-ink py-3 text-sm font-semibold disabled:opacity-50">
            {aiBusy ? t("aiWorking") : `✦ ${t("aiCheck")}`}
          </button>
        )}
        {ai && (
          <div className="mt-3 rounded-xl bg-canvas p-3 text-sm">
            {ai.findings.length ? (
              <ul className="grid gap-1">{ai.findings.map((f, i) => <li key={i}><span className="font-mono text-[11px]">{f.code}</span> {f.description} <span className="text-xs text-muted">({f.severity}, {Math.round(f.confidence * 100)}%)</span></li>)}</ul>
            ) : <p className="text-muted">{ar ? "لم يجد الذكاء الاصطناعي عيوباً ظاهرة." : "AI found no visible defects."}</p>}
            {ai.note && <p className="mt-2 text-xs text-muted">{ai.note}</p>}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div className={`rounded-xl border-2 p-3 ${TAG_STYLE[suggestion.status]}`}>
          <p className="text-xs font-semibold uppercase tracking-wide">{t("suggested")}: {tt(suggestion.status)}</p>
          {suggestion.reasons.length > 0 && <ul className="mt-1 list-disc ps-5 text-xs">{suggestion.reasons.slice(0, 6).map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
        <fieldset>
          <legend className="eyebrow mb-2">{t("result")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {(["green", "yellow", "red"] as const).map((r) => (
              <button type="button" key={r} disabled={!canFull && r !== "red"} onClick={() => setResult(r)} aria-pressed={chosen === r}
                className={`rounded-xl border-2 py-3 text-sm font-bold disabled:opacity-30 ${chosen === r ? TAG_STYLE[r] : "border-line bg-panel text-muted"}`}>
                {tt(r).split(" · ")[0]}
              </button>
            ))}
          </div>
          {!canFull && <p className="mt-2 text-xs text-muted">{t("redOnly")}</p>}
        </fieldset>
        {chosen === "yellow" && (
          <div className="grid gap-1">
            <label htmlFor="restrictions" className="text-xs font-medium">{t("restrictions")}</label>
            <textarea id="restrictions" required rows={2} value={restrictions || (ar ? suggestion.restrictionsAr : suggestion.restrictions).join("; ")} onChange={(e) => setRestrictions(e.target.value)} className="rounded-xl border border-line px-3 py-2 text-sm" />
          </div>
        )}
        {needsOverride && (
          <div className="grid gap-1">
            <label htmlFor="override" className="text-xs font-semibold text-tag-red">{t("override")}</label>
            <textarea id="override" required minLength={10} rows={2} value={override} onChange={(e) => setOverride(e.target.value)} className="rounded-xl border border-tag-red px-3 py-2 text-sm" />
          </div>
        )}
        <div className="grid gap-1">
          <label htmlFor="notes" className="text-xs font-medium">{t("notes")}</label>
          <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-xl border border-line px-3 py-2 text-sm" />
        </div>
        <label className="flex items-start gap-3 rounded-xl bg-canvas p-3 text-sm">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-5 accent-brand" />
          {t("confirm")}
        </label>
      </section>

      {msg && <div role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ${msg.ok ? "bg-tag-green-bg text-tag-green" : "bg-tag-red-bg text-tag-red"}`}>{msg.text}</div>}
      {!done && (
        <button disabled={busy || !confirm} className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-xl bg-brand py-4 text-base font-bold text-white shadow-lg disabled:opacity-40">
          {busy ? t("submitting") : `${t("submit")} · ${tt(chosen).split(" · ")[0]}`}
        </button>
      )}
      {done && <a href="/field" className="rounded-xl bg-ink py-4 text-center text-base font-bold text-white">{t("back")}</a>}
    </form>
  );
}
