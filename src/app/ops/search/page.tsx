import { SearchPage } from "@/components/shell/search-page";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession("staff");
  return <SearchPage s={s} q={(await searchParams).q} />;
}
