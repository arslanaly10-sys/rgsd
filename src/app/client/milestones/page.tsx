import { MilestonesPage } from "@/components/delivery/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("client");
  return <MilestonesPage s={s} base="/client" msg={(await searchParams).msg} />;
}
