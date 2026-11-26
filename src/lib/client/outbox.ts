"use client";
/* Offline outbox for field inspections, in IndexedDB. Each item is retried until the server accepts it (the server is idempotent on offline_id). */
const DB = "rgs-field", STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "offline_id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type OutboxItem = { offline_id: string; tag_no: string; queued_at: string; last_error?: string; [k: string]: unknown };

export const outbox = {
  add: (item: OutboxItem) => tx("readwrite", (s) => s.put(item)),
  all: () => tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>),
  remove: (id: string) => tx("readwrite", (s) => s.delete(id)),
};

export async function postInspection(payload: Record<string, unknown>) {
  const res = await fetch("/api/field/inspections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Send everything waiting. Items the server rejects as invalid (4xx) stay with their error so the inspector can see why. */
export async function syncOutbox() {
  const items = await outbox.all();
  let sent = 0;
  for (const it of items) {
    try {
      const { queued_at: _q, last_error: _e, ...payload } = it;
      const r = await postInspection(payload);
      if (r.ok) { await outbox.remove(it.offline_id); sent++; }
      else if (r.status >= 400 && r.status < 500 && r.status !== 401) await outbox.add({ ...it, last_error: String(r.data.error ?? r.status) });
    } catch {
      break; // still offline
    }
  }
  return { sent, left: (await outbox.all()).length };
}

/** Shrink a photo on the phone before upload or storage (long edge 1600 px, JPEG 0.8). */
export async function downscale(file: File, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
