import { getSession } from "@/lib/auth";
import { one, withUser } from "@/lib/db";
import { getFile } from "@/lib/storage";

/** Serve an uploaded document only if the signed-in user can see its row (RLS decides). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Sign in", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const doc = await withUser(s, (db) => one<{ storage_path: string; mime: string; title: string }>(db, "select storage_path, mime, title from documents where id = $1", [id]));
  if (!doc?.storage_path) return new Response("Not found", { status: 404 });
  const data = await getFile(doc.storage_path);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": doc.mime,
      "cache-control": "private, max-age=3600",
      "content-disposition": `inline; filename="${encodeURIComponent(doc.title)}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
