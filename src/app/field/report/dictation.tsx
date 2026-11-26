"use client";
import { useRef, useState } from "react";

// Crew languages supported by the browser's speech recognition (Chrome / Edge / Safari).
const LANGS: [string, string][] = [["en-US", "English"], ["ar-SA", "العربية"], ["ur-PK", "اردو"], ["hi-IN", "हिन्दी"], ["ml-IN", "മലയാളം"], ["fil-PH", "Tagalog"], ["bn-BD", "বাংলা"]];

type Rec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void; onend: () => void; onerror: (e: { error: string }) => void };

export function Dictation() {
  const [lang, setLang] = useState("ur-PK");
  const [text, setText] = useState("");
  const [on, setOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!R) { setNote("This browser can't take dictation. Type the report instead."); return; }
    const r = new R();
    r.lang = lang; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + " "; if (t) setText((x) => (x ? `${x} ${t}` : t).trim()); };
    r.onend = () => setOn(false);
    r.onerror = (e) => { setNote(e.error === "not-allowed" ? "Allow the microphone to dictate." : `Dictation stopped (${e.error}).`); setOn(false); };
    rec.current = r; r.start(); setOn(true); setNote(null);
  };
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <select name="lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">{LANGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button type="button" onClick={toggle} aria-pressed={on} className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 ${on ? "bg-tag-red" : "bg-ink"}`}>{on ? "● Stop recording" : "🎙 Speak your report"}</button>
      </div>
      <textarea name="transcript" value={text} onChange={(e) => setText(e.target.value)} rows={5} required minLength={5} aria-label="Report" placeholder="e.g. Aaj IN-K1 par 40 meter cladding mukammal, hawa ki wajah se 1 ghanta ruke" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
      {note && <p className="text-xs text-tag-red">{note}</p>}
    </div>
  );
}
