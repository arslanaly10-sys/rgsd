import Link from "next/link";
import { getLocale } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { search } from "@/lib/search";
import { tx } from "../delivery/views";
import { Card, Mono, PageHeader, Pill } from "../ui";

export async function SearchPage({ s, q }: { s: Session; q?: string }) {
  const l = (await getLocale()) as "en" | "ar";
  const hits = q ? await search(s, q) : [];
  const groups = Object.entries(Object.groupBy(hits, (h) => h.kind));
  return (
    <>
      <PageHeader title={tx(l, "Search", "بحث")} sub={q ? tx(l, `${hits.length} result(s) for “${q}”`, `${hits.length} نتيجة لـ «${q}»`) : tx(l, "Search projects, areas, documents, sign-offs, findings, tickets, invoices and scaffold tags.", "ابحث في المشاريع والمناطق والمستندات والتوقيعات والملاحظات والتذاكر والفواتير وبطاقات السقالات.")} />
      <form className="mb-4 flex gap-2" role="search">
        <input name="q" defaultValue={q} autoFocus aria-label={tx(l, "Search", "بحث")} className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2" placeholder={tx(l, "e.g. PRJ-26-003, flood test, NCR-26, TK-26", "مثال: PRJ-26-003")} />
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{tx(l, "Search", "بحث")}</button>
      </form>
      {q && !hits.length && <Card><p className="text-sm text-muted">{tx(l, "Nothing found. Try a reference such as PRJ-26-001, a tag number or a word from the title.", "لا نتائج.")}</p></Card>}
      <div className="grid gap-4">
        {groups.map(([kind, list]) => (
          <Card key={kind} title={`${kind} · ${list!.length}`}>
            <ul className="divide-y divide-line">{list!.map((h, i) => (
              <li key={i}><Link href={h.href} data-hit={h.kind} className="flex items-center justify-between gap-3 py-2 hover:text-brand"><span className="min-w-0"><Mono>{h.ref}</Mono> <span className="font-medium">{h.title}</span></span>{h.sub && <Pill>{h.sub.replace(/_/g, " ")}</Pill>}</Link></li>
            ))}</ul>
          </Card>
        ))}
      </div>
    </>
  );
}
