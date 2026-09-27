// Outbox and inbox on the Supabase database, using the service-role RPCs from migration 0002
// (claim_outbound, complete_outbound, agent_handle_inbound). Needs the secret (service role) key: those RPCs
// are not granted to the public key.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Mood, Scope } from "../domain/moods.js";
import type {
  ContactDirectory,
  DeliverableCheckIn,
  Inbox,
  InboundResult,
  Outbox,
  OutboxMessage,
  PhoneVerifications,
} from "./ports.js";
import type { Channel } from "./providers/types.js";
import type { AudienceLabel } from "./templates/labels.js";

export function connectSupabase(db: { url: string; secretKey: string }): SupabaseClient {
  return createClient(db.url, db.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

interface OutboxRow {
  id: number;
  user_id: string;
  channel: Channel;
  address: string;
  kind: string;
  body: string;
  check_in_id: string | null;
}

export function createSupabaseOutbox(db: SupabaseClient): Outbox {
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("claim_outbound", { p_limit: limit });
      if (error) throw new Error(`claim_outbound: ${error.message}`);
      return ((data ?? []) as OutboxRow[]).map(
        (r): OutboxMessage => ({
          id: r.id,
          userId: r.user_id,
          channel: r.channel,
          address: r.address,
          kind: r.kind,
          body: r.body,
          checkInId: r.check_in_id,
        }),
      );
    },

    async complete(id, report) {
      const { error } = await db.rpc("complete_outbound", {
        p_id: id,
        p_ok: report.ok,
        p_provider_message_id: report.ok ? report.providerMessageId : null,
        p_error: report.ok ? null : report.error,
      });
      if (error) throw new Error(`complete_outbound: ${error.message}`);
    },

    async getCheckIn(checkInId, recipientId) {
      const [checkIn, recipient] = await Promise.all([
        db.from("check_ins").select("id, user_id, mood, scope, text, status").eq("id", checkInId).maybeSingle(),
        db
          .from("check_in_recipients")
          .select("audience_label")
          .eq("check_in_id", checkInId)
          .eq("recipient_id", recipientId)
          .maybeSingle(),
      ]);
      if (checkIn.error) throw new Error(`check_ins: ${checkIn.error.message}`);
      if (recipient.error) throw new Error(`check_in_recipients: ${recipient.error.message}`);
      const c = checkIn.data;
      if (!c || c.status !== "delivered" || !recipient.data) return null;

      const author = await db.from("profiles").select("display_name").eq("id", c.user_id).maybeSingle();
      if (author.error) throw new Error(`profiles: ${author.error.message}`);

      return {
        id: c.id,
        authorName: author.data?.display_name ?? "A friend",
        mood: c.mood as Mood | null,
        scope: c.scope as Scope,
        text: c.text,
        audience: recipient.data.audience_label as AudienceLabel,
      } satisfies DeliverableCheckIn;
    },
  };
}

export function createSupabaseInbox(db: SupabaseClient): Inbox {
  return {
    async handle(msg) {
      const { data, error } = await db.rpc("agent_handle_inbound", {
        p_channel: msg.channel,
        p_address: msg.from,
        p_text: msg.text,
        p_reply_to: msg.replyTo,
        p_reaction: msg.reaction,
      });
      if (error) throw new Error(`agent_handle_inbound: ${error.message}`);
      const r = data as { action: InboundResult["action"]; user_id?: string; names?: string[] | null };
      return { action: r.action, userId: r.user_id ?? null, names: r.names ?? [] };
    },
  };
}

export function createSupabaseContacts(db: SupabaseClient): ContactDirectory {
  return {
    async listPhones() {
      const ids = await db.from("channel_identities").select("user_id, address, verified_at").eq("channel", "imessage");
      if (ids.error) throw new Error(`channel_identities: ${ids.error.message}`);
      const userIds = [...new Set(ids.data.map((r) => r.user_id as string))];
      const names = userIds.length
        ? await db.from("profiles").select("id, display_name").in("id", userIds)
        : { data: [], error: null };
      if (names.error) throw new Error(`profiles: ${names.error.message}`);
      const byId = new Map(names.data.map((p) => [p.id as string, (p.display_name as string | null) ?? null]));
      return ids.data.map((r) => ({
        phone: r.address as string,
        name: byId.get(r.user_id as string) ?? null,
        verified: r.verified_at !== null,
      }));
    },
  };
}

// phone_verifications (migration 0006), read and written with the service role.
export function createSupabaseVerifications(db: SupabaseClient): PhoneVerifications {
  return {
    async listUnlinked() {
      const rows = await db
        .from("phone_verifications")
        .select("user_id, phone")
        .is("verified_at", null)
        .is("photon_user_id", null)
        .gt("expires_at", new Date().toISOString());
      if (rows.error) throw new Error(`phone_verifications: ${rows.error.message}`);
      if (!rows.data.length) return [];
      const names = await db.from("profiles").select("id, display_name").in("id", rows.data.map((r) => r.user_id as string));
      if (names.error) throw new Error(`profiles: ${names.error.message}`);
      const byId = new Map(names.data.map((p) => [p.id as string, (p.display_name as string | null) ?? null]));
      return rows.data.map((r) => ({
        userId: r.user_id as string,
        phone: r.phone as string,
        name: byId.get(r.user_id as string) ?? null,
      }));
    },

    async link(userId, phone, user) {
      // Only if it's still that number: the user may have entered another one since.
      const { error } = await db
        .from("phone_verifications")
        .update({ photon_user_id: user.id, line_number: user.line })
        .eq("user_id", userId)
        .eq("phone", phone)
        .is("verified_at", null);
      if (error) throw new Error(`phone_verifications: ${error.message}`);
    },
  };
}
