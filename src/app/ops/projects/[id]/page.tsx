import { ProjectDetailPage } from "@/components/delivery/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  return <ProjectDetailPage s={s} base="/ops" id={(await params).id} msg={(await searchParams).msg} />;
}
