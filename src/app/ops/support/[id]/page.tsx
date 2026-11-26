import { TicketPage } from "@/components/commercial/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return <TicketPage s={s} base="/ops" id={id} msg={(await searchParams).msg} />;
}
