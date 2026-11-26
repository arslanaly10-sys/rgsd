"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./nav-links";

type Step = { kind: string; name: string; tier?: number; status: "ok" | "approval" | "denied" | "error"; approvalId?: string };
type Msg = { role: "user" | "assistant"; text: string; steps?: Step[]; agent?: string; runId?: string; mode?: string; feedback?: "up" | "down" };

/** Minimal safe formatting: **bold** and line breaks. Text is rendered as React nodes, never as HTML. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} className={line.startsWith("•") ? "ps-3 -indent-3" : ""}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>))}
        </p>
      ))}
    </>
  );
}

export function Copilot({ area }: { area: "ops" | "client" }) {
  const t = useTranslations("copilot");
  const locale = useLocale() as "en" | "ar";
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState<string | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(q: string) {
    const msg = q.trim();
    if (!msg || busy) return;
    setErr(null);
    setMsgs((m) => [...m, { role: "user", text: msg }]);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: msg, conversationId: conv, page: path, locale }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setConv(data.conversationId);
      setMsgs((m) => [...m, { role: "assistant", text: data.reply, steps: data.steps, agent: data.agentLabel, runId: data.runId, mode: data.mode }]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rate(i: number, feedback: "up" | "down") {
    const m = msgs[i];
    if (!m.runId) return;
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, feedback } : x)));
    await fetch("/api/copilot/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: m.runId, feedback }) }).catch(() => {});
  }

  const suggestions = t.raw(`suggest.${area}`) as string[];
  const stepTone = { ok: "bg-slate-100 text-slate-700", approval: "bg-tag-yellow-bg text-tag-yellow", denied: "bg-tag-red-bg text-tag-red", error: "bg-tag-red-bg text-tag-red" };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] end-5 z-40 flex items-center gap-2 rounded-full bg-ink py-3 pe-5 ps-4 text-sm font-semibold text-white shadow-lg shadow-ink/20 transition hover:bg-ink-2 ${open ? "hidden" : ""}`}
        aria-label={t("open")}
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-brand"><Icon name="spark" className="size-4" /></span>
        {t("open")}
        <kbd className="hidden rounded bg-white/10 px-1.5 text-[10px] font-medium text-white/60 sm:inline">⌘K</kbd>
      </button>

      {open && (
        <aside className="fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-line bg-panel shadow-2xl sm:w-[440px]" role="dialog" aria-label={t("title")}>
          <header className="flex items-center justify-between gap-2 bg-ink px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-brand"><Icon name="spark" className="size-4" /></span>
              <div className="leading-tight">
                <div className="font-display text-sm font-semibold">{t("title")}</div>
                <div className="text-[11px] text-white/50">{msgs.find((m) => m.mode)?.mode === "live" ? t("live") : t("mock")}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setMsgs([]); setConv(undefined); }} className="rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10">{t("newChat")}</button>
              <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-lg leading-none text-white/70 hover:bg-white/10" aria-label={t("close")}>×</button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {msgs.length === 0 && (
              <div>
                <p className="text-sm text-muted">{t("intro")}</p>
                <div className="mt-4 flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-lg border border-line px-3 py-2 text-start text-sm hover:border-brand hover:bg-brand-50">{s}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-4">
              {msgs.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-ee-sm bg-ink px-3.5 py-2 text-sm text-white">{m.text}</div>
                ) : (
                  <div key={i} className="flex flex-col gap-1.5">
                    {m.agent && <span className="eyebrow">{m.agent}</span>}
                    {!!m.steps?.filter((s) => s.kind === "tool").length && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.steps!.filter((s) => s.kind === "tool").map((s, j) => (
                          <span key={j} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] ${stepTone[s.status]}`} title={s.status === "approval" ? t("approval") : s.status === "denied" ? t("denied") : s.status === "error" ? t("error") : ""}>
                            {s.status === "approval" ? "⏳" : s.status === "ok" ? "✓" : "✕"} {s.name}{s.tier != null ? ` · T${s.tier}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col gap-1 rounded-2xl rounded-es-sm bg-canvas px-3.5 py-2.5 text-sm leading-relaxed"><Rich text={m.text} /></div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      {m.steps?.some((s) => s.status === "approval") && area === "ops" && <Link href="/ops/approvals" className="font-semibold text-brand">{t("viewApprovals")} →</Link>}
                      <button onClick={() => rate(i, "up")} className={m.feedback === "up" ? "text-tag-green" : "hover:text-ink"} aria-label={t("helpful")}>👍</button>
                      <button onClick={() => rate(i, "down")} className={m.feedback === "down" ? "text-tag-red" : "hover:text-ink"} aria-label={t("notHelpful")}>👎</button>
                    </div>
                  </div>
                ),
              )}
              {busy && <div className="text-sm text-muted animate-pulse">{t("thinking")}</div>}
              {err && <div className="rounded-lg bg-tag-red-bg px-3 py-2 text-sm text-tag-red">{err}</div>}
              <div ref={endRef} />
            </div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <label htmlFor="copilot-input" className="sr-only">{t("placeholder")}</label>
            <textarea
              id="copilot-input" value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={t("placeholder")}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
              className="min-h-[42px] flex-1 resize-none rounded-xl border border-line px-3 py-2.5 text-sm focus:border-brand focus:outline-none"
            />
            <button disabled={busy || !text.trim()} className="rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-40">{t("send")}</button>
          </form>
        </aside>
      )}
    </>
  );
}
