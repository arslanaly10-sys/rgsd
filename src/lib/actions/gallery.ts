"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { GalleryError, updatePhoto, uploadPhoto } from "@/lib/gallery";

const back = (path: string, msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);

export async function uploadPhotoAction(fd: FormData) {
  const s = await requireSession("staff");
  const projectId = String(fd.get("projectId"));
  const path = `/ops/projects/${projectId}?tab=photos`;
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) back(path, "err:Choose a photo.");
  let m: string;
  try {
    m = await uploadPhoto(s, projectId, file as File, {
      areaId: String(fd.get("areaId") || "") || null, line: String(fd.get("line") || "") || null, stage: String(fd.get("stage") || "") || null,
      caption: String(fd.get("caption") ?? ""), takenOn: String(fd.get("takenOn") || "") || null, visible: fd.get("visible") === "1", cover: fd.get("cover") === "1",
    });
  } catch (e) {
    if (!(e instanceof GalleryError)) console.error("[gallery]", e);
    return back(path, `err:${e instanceof GalleryError ? e.message : "Upload failed. Nothing was saved."}`);
  }
  revalidatePath("/", "layout");
  back(path, `ok:${m}`);
}

export async function photoAction(fd: FormData) {
  const s = await requireSession("staff");
  const projectId = String(fd.get("projectId"));
  const path = `/ops/projects/${projectId}?tab=photos`;
  let m: string;
  try { m = await updatePhoto(s, String(fd.get("id")), String(fd.get("op")) as "cover" | "share" | "hide" | "delete"); }
  catch (e) { return back(path, `err:${e instanceof GalleryError ? e.message : "Something went wrong."}`); }
  revalidatePath("/", "layout");
  back(path, `ok:${m}`);
}
