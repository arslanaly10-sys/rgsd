import { ContactsPage } from "@/components/commercial/pages";
import { requireSession } from "@/lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const s = await requireSession("staff");
  return <ContactsPage s={s} base="/ops" msg={(await searchParams).msg} />;
}
