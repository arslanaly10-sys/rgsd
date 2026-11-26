"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { outbox, syncOutbox, type OutboxItem } from "@/lib/client/outbox";

/** Shows queued inspections, syncs when the phone comes back online, and registers the service worker. */
export function OutboxSync() {
  const t = useTranslations("field");
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh() { try { setItems(await outbox.all()); } catch { /* private mode */ } }
  async function sync() {
    setBusy(true);
    try { await syncOutbox(); } finally { setBusy(false); refresh(); }
  }

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (navigator.onLine) sync();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${online ? "bg-tag-green" : "bg-tag-red"}`} data-testid="net">{online ? "Online" : "Offline"}</span>
      {items.length > 0 ? (
        <button onClick={sync} disabled={busy || !online} className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold disabled:opacity-50" data-testid="outbox">
          {t("outbox", { count: items.length })} · {busy ? "…" : t("syncNow")}
        </button>
      ) : <span className="text-[11px] text-white/50" data-testid="outbox-empty">{t("synced")}</span>}
    </div>
  );
}
