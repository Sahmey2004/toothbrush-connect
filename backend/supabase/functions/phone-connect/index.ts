// Start phone verification for the signed-in user and register the number with Photon.
//
//   POST { phone }   (supabase.functions.invoke sends the user's session)
//   → { phone, code, link, line_number, dry_run }
//
// `link` is Photon's per-user redirect: it opens Messages addressed to the user's assigned line with
// "Verify 123456" filled in. The agent receives that text and completes the verification. This runs
// here, not in the browser, because Photon's users API needs the project secret.
import { createClient } from "npm:@supabase/supabase-js@2";

const PHOTON = "https://spectrum.photon.codes";
const projectId = Deno.env.get("PHOTON_PROJECT_ID");
const projectSecret = Deno.env.get("PHOTON_PROJECT_SECRET");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const redirectLink = (photonUserId: string, code: string) =>
  `${PHOTON}/users/${photonUserId}/redirect?msg=${encodeURIComponent(`Verify ${code}`)}`;

interface PhotonUser { id: string; phoneNumber: string; assignedPhoneNumber?: string | null }

// Get-or-create by phone: re-POSTing an existing number would overwrite its name.
async function photonUser(phone: string, firstName: string): Promise<PhotonUser> {
  const auth = { Authorization: `Basic ${btoa(`${projectId}:${projectSecret}`)}` };
  const base = `${PHOTON}/projects/${projectId}/users/`;

  const list = await fetch(`${base}?search=${encodeURIComponent(phone)}&limit=50`, { headers: auth });
  if (list.ok) {
    const users: PhotonUser[] = (await list.json())?.data?.users ?? [];
    const hit = users.find((u) => u.phoneNumber === phone);
    if (hit?.id) return hit;
  }
  const res = await fetch(base, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "shared", phoneNumber: phone, ...(firstName ? { firstName } : {}) }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.succeed || !body?.data?.id) {
    throw new Error(`Photon users API ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  }
  return body.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in first." }, 401);
  const { phone } = await req.json().catch(() => ({}));

  // As the user: checks the session and the number, and creates the code.
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: started, error } = await asUser.rpc("start_phone_verification", { p_phone: String(phone ?? "") });
  if (error) return json({ error: error.message }, 400);

  if (!projectId || !projectSecret) {
    return json({ ...started, link: null, line_number: null, dry_run: true });
  }

  try {
    const { data: me } = await asUser.rpc("get_me");
    const user = await photonUser(started.phone, String(me?.display_name ?? "").split(" ")[0]);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Only the row this request created: if the user has since submitted another number, the row now
    // holds that one, and this number's Photon user must not be written onto it.
    await admin.from("phone_verifications")
      .update({ photon_user_id: user.id, line_number: user.assignedPhoneNumber ?? null })
      .eq("user_id", started.user_id)
      .eq("phone", started.phone)
      .eq("code", started.code);
    return json({
      ...started,
      photon_user_id: user.id,
      line_number: user.assignedPhoneNumber ?? null,
      link: redirectLink(user.id, started.code),
      dry_run: false,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn't set up your number with Photon. Try again in a minute." }, 502);
  }
});
