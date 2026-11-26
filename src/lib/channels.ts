import "server-only";
import { one, rows, withSystem, type Db } from "./db";

/*
 * Outbound channels. Every message is written to outbound_messages first (the outbox), then sent.
 * Providers switch on when their keys are present; otherwise the message is "logged" (kept in the
 * outbox, visible to admins) so the platform runs end to end with no accounts.
 *   Email:    Resend           RESEND_API_KEY, EMAIL_FROM
 *   WhatsApp: Meta Cloud API   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
 *   SMS:      Unifonic (KSA)   UNIFONIC_APP_SID, UNIFONIC_SENDER
 * Keys go into Vercel / the environment's secret store, never into the database or the repo.
 */

export type Channel = "email" | "whatsapp" | "sms";
type Sent = { status: "sent" | "logged" | "failed"; provider: string; providerId?: string; error?: string };

export function channelStatus() {
  return {
    email: process.env.RESEND_API_KEY ? "resend" : "log only",
    whatsapp: process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID ? "meta cloud api" : "log only",
    sms: process.env.UNIFONIC_APP_SID ? "unifonic" : "log only",
  };
}

async function post(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

async function deliver(channel: Channel, to: string, subject: string | null, body: string): Promise<Sent> {
  try {
    if (channel === "email" && process.env.RESEND_API_KEY) {
      const j = await post("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || "RGS OneSite <no-reply@rgsksa.com>", to: [to], subject: subject ?? "RGS OneSite", text: body }),
      });
      return { status: "sent", provider: "resend", providerId: j.id };
    }
    if (channel === "whatsapp" && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
      const j = await post(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body: subject ? `*${subject}*\n${body}` : body } }),
      });
      return { status: "sent", provider: "whatsapp", providerId: j.messages?.[0]?.id };
    }
    if (channel === "sms" && process.env.UNIFONIC_APP_SID) {
      const form = new URLSearchParams({ AppSid: process.env.UNIFONIC_APP_SID, SenderID: process.env.UNIFONIC_SENDER || "RGS", Recipient: to.replace(/\D/g, ""), Body: (subject ? `${subject}: ${body}` : body).slice(0, 320) });
      const j = await post("https://el.cloud.unifonic.com/rest/SMS/messages", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
      return { status: "sent", provider: "unifonic", providerId: j.data?.MessageID ? String(j.data.MessageID) : undefined };
    }
    return { status: "logged", provider: "log" };
  } catch (e) {
    return { status: "failed", provider: channel, error: (e as Error).message.slice(0, 300) };
  }
}

/** Queue and send one message. Used directly for sign-in codes and invitations. */
export async function sendMessage(x: { orgId?: string | null; profileId?: string | null; notificationId?: string | null; channel: Channel; to: string; subject?: string | null; body: string }, db?: Db) {
  const run = async (d: Db) => {
    const m = await one<{ id: string }>(d, `insert into outbound_messages (org_id, profile_id, notification_id, channel, to_addr, subject, body) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [x.orgId ?? null, x.profileId ?? null, x.notificationId ?? null, x.channel, x.to, x.subject ?? null, x.body]);
    const r = await deliver(x.channel, x.to, x.subject ?? null, x.body);
    await d.query(`update outbound_messages set status = $2, provider = $3, provider_id = $4, error = $5, attempts = attempts + 1, sent_at = case when $2 in ('sent','logged') then now() end where id = $1`,
      [m!.id, r.status, r.provider, r.providerId ?? null, r.error ?? null]);
    return { id: m!.id, ...r };
  };
  return db ? run(db) : withSystem(run);
}

const APP_URL = () => process.env.APP_URL || "http://localhost:3100";

/**
 * Fan notifications out to people's chosen channels. A notification is addressed to a person, a staff role,
 * or a whole client company; the in-app bell always shows it, and this adds email / WhatsApp / SMS.
 * Runs from the workflow tick (cron) and after key actions.
 */
export async function dispatchNotifications(limit = 100) {
  return withSystem(async (db) => {
    const list = await rows<{ id: string; org_id: string; user_id: string | null; role: string | null; client_company_id: string | null; title: string; title_ar: string | null; body: string | null; link: string | null; kind: string }>(db,
      `select id, org_id, user_id, role, client_company_id, title, title_ar, body, link, kind from notifications where dispatched_at is null order by created_at limit $1 for update skip locked`, [limit]);
    let sent = 0, logged = 0, failed = 0;
    for (const n of list) {
      const people = await rows<{ id: string; email: string; phone: string | null; locale: string; notify: { email?: boolean; whatsapp?: boolean; sms?: boolean } }>(db,
        `select id, email, phone, locale, notify from profiles where org_id = $1 and status = 'active' and (
           ($2::uuid is not null and id = $2) or
           ($2::uuid is null and $3::text is not null and role = $3 and ($4::uuid is null or client_company_id = $4)) or
           ($2::uuid is null and $3::text is null and $4::uuid is not null and client_company_id = $4))`,
        [n.org_id, n.user_id, n.role, n.client_company_id]);
      for (const p of people) {
        const subject = p.locale === "ar" && n.title_ar ? n.title_ar : n.title;
        const body = `${n.body ? `${n.body}\n\n` : ""}${n.link ? `${APP_URL()}${n.link}` : APP_URL()}`;
        const chans: [Channel, string | null][] = [["email", p.notify?.email ? p.email : null], ["whatsapp", p.notify?.whatsapp ? p.phone : null], ["sms", p.notify?.sms && /urgent|overdue|red|safety|hold/i.test(`${n.kind} ${n.title}`) ? p.phone : null]];
        for (const [ch, to] of chans) {
          if (!to) continue;
          const r = await sendMessage({ orgId: n.org_id, profileId: p.id, notificationId: n.id, channel: ch, to, subject, body }, db);
          if (r.status === "sent") sent++; else if (r.status === "logged") logged++; else failed++;
        }
      }
      await db.query("update notifications set dispatched_at = now() where id = $1", [n.id]);
    }
    return { notifications: list.length, sent, logged, failed, summary: `${list.length} notification(s): ${sent} sent, ${logged} logged (no provider key), ${failed} failed.` };
  });
}
