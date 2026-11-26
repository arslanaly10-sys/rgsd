import { ProjectDetailPage } from "@/components/delivery/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; tab?: string; line?: string; stage?: string }> }) {
  const s = await requireSession("client");
  return <ProjectDetailPage s={s} base="/client" id={(await params).id} {...(await searchParams)} />;
}
