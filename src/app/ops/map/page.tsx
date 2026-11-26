import { MapPage } from "@/components/delivery/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  const s = await requireSession("staff");
  return <MapPage s={s} base="/ops" city={(await searchParams).city} />;
}
