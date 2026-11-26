import Link from "next/link";
import { getLocale } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { listChain, recentChains, type Handoff } from "@/lib/agents/handoffs";
import { tx } from "../delivery/views";
import { Card, Mono, PageHeader, Pill } from "../ui";

const TONE: Record<string, "green" | "yellow" | "red" | "neutral"> = { done: "green", waiting: "yellow", approved: "green", rejected: "red" };
const isAgent = (x: string) => /agent/i.test(x);

export function HandoffTimeline({ steps, l }: { steps: Handoff[]; l: "en" | "ar" }) {
  if (!steps.length) return <p className="text-sm text-muted">{tx(l, "No handoffs yet.", "لا توجد عمليات تسليم بعد.")}</p>;
  return (
    <ol className="relative grid gap-4 border-s-2 border-line ps-6" data-timeline>
      {steps.map((h) => (
        <li key={h.step} className="relative" data-step={h.status}>
          <span className={`absolute -start-[33px] top-0.5 flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white ring-4 ring-canvas ${h.status === "waiting" ? "bg-tag-yellow" : h.status === "rejected" ? "bg-tag-red" : "bg-tag-green"}`}>{h.step}</span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-md px-2 py-0.5 font-semibold ${isAgent(h.from_label) ? "bg-brand-50 text-brand-600" : "bg-canvas"}`}>{isAgent(h.from_label) ? "✦ " : ""}{h.from_label}</span>
            <span aria-hidden className="text-muted rtl:rotate-180">→</span>
            <span className={`rounded-md px-2 py-0.5 font-semibold ${isAgent(h.to_label) ? "bg-brand-50 text-brand-600" : "bg-canvas"}`}>{isAgent(h.to_label) ? "✦ " : ""}{h.to_label}</span>
            <Pill tone={TONE[h.status]}>{h.status}</Pill>
          </div>
          <p className="mt-1 text-sm">{h.link ? <Link href={h.link} className="hover:text-brand">{h.action}</Link> : h.action}</p>
          <p className="text-xs text-muted">{new Date(h.created_at).toLocaleString(l === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" })}</p>
        </li>
      ))}
    </ol>
  );
}

export async function JourneysPage({ s, chain }: { s: Session; chain?: string }) {
  const l = (await getLocale()) as "en" | "ar";
  const chains = await recentChains(s);
  const sel = chain && chains.some((c) => c.chain === chain) ? chain : chains[0]?.chain;
  const steps = sel ? await listChain(s, sel) : [];
  const base = s.isStaff ? "/ops" : "/client";
  return (
    <>
      <PageHeader title={tx(l, "Request journeys", "رحلة الطلبات")} sub={tx(l, "How each request moves between people and their agents, from the client's first message to an accepted quote and mobilisation. ✦ marks an agent.", "كيف ينتقل كل طلب بين الأشخاص ووكلائهم. ✦ تعني وكيلاً.")} />
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card title={tx(l, "Recent", "الأحدث")}>
          <ul className="grid gap-1">{chains.map((c) => (
            <li key={c.chain}><Link href={`${base}/journeys?chain=${encodeURIComponent(c.chain)}`} data-chain={c.ref ?? c.chain} className={`block rounded-lg px-3 py-2 text-sm ${c.chain === sel ? "bg-brand-50" : "hover:bg-canvas"}`}><Mono>{c.ref ?? c.chain.slice(0, 16)}</Mono> <span className="font-medium">{c.title ?? ""}</span><span className="block text-xs text-muted">{c.steps} step(s) · {c.status}</span></Link></li>
          ))}{!chains.length && <li className="text-sm text-muted">{tx(l, "No journeys yet. Raise a request to start one.", "لا توجد رحلات بعد.")}</li>}</ul>
        </Card>
        <Card title={tx(l, "Journey", "الرحلة")}><HandoffTimeline steps={steps} l={l} /></Card>
      </div>
    </>
  );
}
