import { requireSession } from "@/lib/auth";

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  await requireSession("staff");
  return <div className="mx-auto min-h-dvh max-w-md bg-canvas">{children}</div>;
}
