import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Session } from "@/lib/auth";
import { clientHome, kindLabel, roleLabel } from "@/lib/client-home";
import { fmtDate, type Loc } from "@/lib/format";
import { covers, projectExtras } from "@/lib/gallery";
import { listProjects } from "@/lib/projects";
import { listContacts } from "@/lib/support";
import { tx } from "../delivery/views";
import { ProjectGrid, ProjectImage } from "../projects/visual";
import { Card, Flash, Mono, Pill } from "../ui";

const CAP_LABEL: Record<string, [string, string]> = { viewer: ["Customer viewer", "مشاهد"], requester: ["Customer requester", "مقدم طلبات"], approver: ["Customer approver", "معتمد"] };
const ENTITY_TONE: Record<string, string> = { Progress: "bg-brand", Instruction: "bg-ink", Variation: "bg-tag-yellow", "Sign-off": "bg-tag-green", Milestone: "bg-tag-green", Inspection: "bg-brand" };

function greeting(l: Loc) {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }));
  return h < 12 ? tx(l, "Good morning", "صباح الخير") : h < 17 ? tx(l, "Good afternoon", "مساء الخير") : tx(l, "Good evening", "مساء الخير");
}

export async function ClientOverview({ s, msg }: { s: Session; msg?: string }) {
  const l = (await getLocale()) as Loc;
  const t = await getTranslations();
  const [h, projects, cov, ex, contacts] = await Promise.all([clientHome(s), listProjects(s), covers(s), projectExtras(s), listContacts(s)]);
  const first = (l === "ar" && s.fullNameAr ? s.fullNameAr : s.fullName).split(" ")[0];
  const company = (l === "ar" && s.companyNameAr) || s.companyName;
  const heroCover = projects.map((p) => cov[p.id]).find(Boolean);
  const rep = contacts.find((c) => c.side === "rgs");
  const viewOnly = !h.caps.request;
  const firstProject = projects[0];
  const quick = [
    { key: "request", icon: "M12 5v14M5 12h14", label: tx(l, "Raise a request", "تقديم طلب"), href: "/client/requests#new", enabled: h.caps.request },
    { key: "evidence", icon: "M12 16V4m0 0-5 5m5-5 5 5M5 20h14", label: tx(l, "Upload evidence", "رفع دليل"), href: projects.length === 1 && firstProject ? `/client/projects/${firstProject.id}?tab=photos#upload` : "/client/projects", enabled: h.caps.request },
  ];
  return (
    <>
      <Flash msg={msg} />
      <section className="mb-6 grid gap-5 rounded-2xl bg-panel p-5 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          <p className="text-sm text-muted">{greeting(l)}, {first}</p>
          <h1 className="mt-1 text-3xl font-semibold">{tx(l, "Your projects at a glance", "مشاريعك في لمحة")}</h1>
          <div className="mt-4 flex flex-wrap gap-2 text-sm" data-chips>
            <span className="rounded-md bg-brand px-3 py-1.5 font-semibold text-white">{s.role === "client_viewer" ? tx(l, ...CAP_LABEL.viewer) : `${tx(l, ...CAP_LABEL[h.caps.label])} · ${t(`roles.${s.role}`)}`}</span>
            <span className="rounded-md border border-line px-3 py-1.5 font-medium">{company}</span>
            <Link href="/client/projects" className="rounded-md border border-line px-3 py-1.5 font-medium hover:border-brand">{tx(l, "Projects", "المشاريع")}: {projects.length}</Link>
            <Link href="/client/signoffs" className="rounded-md border border-line px-3 py-1.5 font-medium hover:border-brand" data-can-act={h.mine}>{tx(l, "You can act on", "يمكنك اتخاذ إجراء على")}: {h.mine}</Link>
            <Link href="#changes" className="rounded-md border border-line px-3 py-1.5 font-medium hover:border-brand" data-changes={h.changes.length}>{h.changes.length} {tx(l, "changes since", "تغييرات منذ")} {fmtDate(h.since, l)}</Link>
          </div>
        </div>
        {heroCover && <ProjectImage url={heroCover.url} kind={heroCover.kind} alt={heroCover.caption} className="hidden aspect-[16/10] rounded-xl md:block" l={l} />}
      </section>

      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {quick.map((q) => (
          <div key={q.key}>
            {q.enabled ? (
              <Link href={q.href} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-5 py-4 text-base font-semibold transition-[border-color,transform] duration-150 hover:border-brand active:scale-[0.99]">
                <svg viewBox="0 0 24 24" className="size-5 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d={q.icon} /></svg>{q.label}
              </Link>
            ) : (
              <>
                <span aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-xl border border-line bg-panel px-5 py-4 text-base font-semibold text-muted">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d={q.icon} /></svg>{q.label}
                </span>
                <p className="mt-1.5 text-xs text-muted">{tx(l, "Your role is view-only. Ask a requester or approver in your organisation.", "دورك للعرض فقط. اطلب من مقدم طلب أو معتمد في مؤسستك.")}</p>
              </>
            )}
          </div>
        ))}
        <Link href={rep?.phone ? `tel:${rep.phone.replace(/[^\d+]/g, "")}` : "/client/contacts"} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-5 py-4 text-base font-semibold transition-[border-color] duration-150 hover:border-brand">
          <svg viewBox="0 0 24 24" className="size-5 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
          <span>{tx(l, "Contact your RGS representative", "تواصل مع ممثل RGS")}{rep && <span className="block text-xs font-normal text-muted">{rep.name} · {rep.phone}</span>}</span>
        </Link>
      </div>

      <div className="mb-3 flex items-end justify-between"><h2 className="text-xl font-semibold">{tx(l, "Assigned projects", "المشاريع المكلفة")}</h2><Link href="/client/projects" className="text-sm font-semibold text-brand underline">{tx(l, "Open project directory", "دليل المشاريع")}</Link></div>
      <ProjectGrid list={projects} covers={cov} extras={ex} base="/client" l={l} />

      <div className="mt-8 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title={tx(l, "Awaiting your organisation", "بانتظار مؤسستك")} action={<Link href="/client/signoffs" className="text-sm font-semibold text-brand underline">{tx(l, "View all", "عرض الكل")} ({h.pending.length})</Link>}>
          {h.pending.length ? <ul className="divide-y divide-line">{h.pending.slice(0, 6).map((p) => (
            <li key={`${p.kind}-${p.id}`} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]" data-pending={p.canAct ? "act" : "view"}>
              <div className="min-w-0">
                <span className="inline-block rounded-md bg-canvas px-2 py-0.5 text-xs font-semibold">{kindLabel(p.kind, l)}</span>
                <p className="mt-1 font-semibold leading-snug">{l === "ar" && p.title_ar ? p.title_ar : p.title}</p>
                <p className="text-xs text-muted">{p.project_ref && <Mono>{p.project_ref}</Mono>}{p.due ? ` · ${tx(l, "Due", "الاستحقاق")} ${fmtDate(p.due, l)}` : ""} · {tx(l, "Who can act", "من يمكنه الإجراء")}: {p.whoCan.map((r) => roleLabel(r, l)).join(", ")}</p>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Pill tone={p.overdue ? "red" : "yellow"}>{p.overdue ? tx(l, "Overdue", "متأخر") : tx(l, "Pending", "معلق")}</Pill>
                {p.canAct ? <Link href={p.href} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">{p.kind === "dependency" ? tx(l, "Update", "تحديث") : p.kind === "document" ? tx(l, "Review", "مراجعة") : tx(l, "Review and sign", "مراجعة وتوقيع")}</Link>
                  : <><span className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted">🔒 {tx(l, "Not available", "غير متاح")}</span><span className="text-[11px] text-muted">{tx(l, "Your role can view this but cannot act on it.", "يمكن لدورك العرض فقط.")}</span></>}
              </div>
            </li>
          ))}</ul> : <p className="text-sm text-muted">{tx(l, "Nothing is waiting on your organisation.", "لا شيء بانتظار مؤسستك.")}</p>}
        </Card>
        <Card title={tx(l, "Upcoming commitments", "الالتزامات القادمة")} action={<Link href="/client/milestones" className="text-sm font-semibold text-brand underline">{tx(l, "All commitments", "كل الالتزامات")}</Link>}>
          <ul className="divide-y divide-line">{h.commitments.map((c) => (
            <li key={c.key} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0"><Link href={c.href} className="font-semibold hover:text-brand">{l === "ar" && c.title_ar ? c.title_ar : c.title}</Link><div className="text-xs text-muted">{c.project_ref && <Mono>{c.project_ref}</Mono>} · {c.owner === "RGS" ? "RGS" : tx(l, "Your organisation", "مؤسستك")}</div></div>
              <div className="text-end"><div className="whitespace-nowrap font-medium">{fmtDate(c.due, l)}</div><Pill tone={c.state === "late" ? "red" : c.state === "risk" ? "yellow" : "green"}>{c.state === "late" ? tx(l, "Late", "متأخر") : c.state === "risk" ? tx(l, "At risk", "معرض للتأخر") : tx(l, "On track", "في المسار")}</Pill></div>
            </li>
          ))}</ul>
        </Card>
        <Card id="changes" title={`${tx(l, "What changed since your last visit", "ما تغير منذ زيارتك الأخيرة")} (${fmtDate(h.since, l)})`} action={<Link href="/client/activity" className="text-sm font-semibold text-brand underline">{tx(l, "Full timeline", "الجدول الزمني الكامل")}</Link>}>
          {h.changes.length ? <ol className="relative grid gap-3 border-s border-line ps-5">{h.changes.slice(0, 10).map((a, i) => (
            <li key={i} className="relative text-sm">
              <span className={`absolute -start-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-panel ${ENTITY_TONE[a.entity] ?? "bg-muted"}`} />
              <div className="text-xs text-muted">{new Date(a.at).toLocaleString(l === "ar" ? "ar-SA" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })} · {a.entity}</div>
              <div>{a.actor && <strong>{a.actor} </strong>}{a.link ? <Link href={a.link} className="hover:text-brand">{a.text}</Link> : a.text}</div>
            </li>
          ))}</ol> : <p className="text-sm text-muted">{tx(l, "Nothing new since your last visit.", "لا جديد منذ زيارتك الأخيرة.")}</p>}
        </Card>
        <Card title={tx(l, "Needs attention", "يحتاج إلى انتباه")}>
          <ul className="grid gap-3">{h.attention.map((a, i) => (
            <li key={i} className="flex gap-3 text-sm"><span className={`mt-1.5 size-2.5 shrink-0 rounded-sm ${a.tone === "red" ? "bg-tag-red" : "bg-tag-yellow"}`} />
              <div><p className="font-medium">{l === "ar" ? a.text_ar : a.text}</p><p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{tx(l, "Evidence", "الدليل")}: {a.evidence.map((e) => <Link key={e.href + e.label} href={e.href} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink hover:border-brand">{e.label}</Link>)}</p></div></li>
          ))}{!h.attention.length && <li className="text-sm text-muted">{tx(l, "Nothing needs attention right now.", "لا شيء يحتاج إلى انتباه الآن.")}</li>}</ul>
          <p className="mt-4 text-xs text-muted">{tx(l, "Built from records you can open; each statement links to its source. The assistant never makes technical decisions.", "مبني من سجلات يمكنك فتحها؛ كل عبارة مرتبطة بمصدرها.")}</p>
        </Card>
      </div>
      {viewOnly && <p className="mt-6 text-xs text-muted">{tx(l, "You have view-only access. To raise requests or sign, ask your organisation's portal admin to change your role.", "لديك صلاحية عرض فقط.")}</p>}
    </>
  );
}
