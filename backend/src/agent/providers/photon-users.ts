// Photon project users. The shared iMessage line only talks to phone numbers listed under the project's
// Users, in both directions ("Target not allowed for this project" otherwise), so every registered phone is
// added here. Spectrum Cloud API: https://spectrum.photon.codes/openapi/json
import type { ContactRegistry } from "../ports.js";

const API = "https://spectrum.photon.codes";

// Area code 555 isn't a real North American area code; seed and test data use it. Registering those would only
// use up the plan's shared-user slots.
const isFictional = (phone: string) => phone.startsWith("+1555");

// fetch alone would wait minutes for a hung request, holding up the contact sync and every send to that phone.
const TIMEOUT_MS = 10_000;

export class PhotonPlanLimit extends Error {
  override readonly name = "PhotonPlanLimit";
}

export function createPhotonUsers(
  photon: { projectId: string; projectSecret: string },
  fetchImpl: typeof fetch = fetch,
): ContactRegistry {
  const base = `${API}/projects/${photon.projectId}/users/`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${photon.projectId}:${photon.projectSecret}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
  let known: Promise<Set<string>> | null = null;
  const adding = new Map<string, Promise<boolean>>(); // phone → its create in flight

  async function listPhones(): Promise<Set<string>> {
    const res = await fetchImpl(base, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Photon list users: HTTP ${res.status}`);
    const body = (await res.json()) as { data: { users: { phoneNumber: string }[] } };
    return new Set(body.data.users.map((u) => u.phoneNumber));
  }

  async function add(phone: string, name?: string | null): Promise<boolean> {
    known ??= listPhones().catch((e) => {
      known = null; // try listing again next time
      throw e;
    });
    const phones = await known;
    if (phones.has(phone)) return false;

    // Idempotent: re-creating an existing phone returns the same user.
    const res = await fetchImpl(base, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ type: "shared", phoneNumber: phone, firstName: name || null }),
    });
    if (res.status === 402) throw new PhotonPlanLimit("Photon plan's shared-user limit reached");
    if (!res.ok) throw new Error(`Photon create user: HTTP ${res.status} ${await res.text()}`);
    phones.add(phone);
    return true;
  }

  return {
    async ensure(phone, name) {
      if (isFictional(phone)) return false;
      // The contact sync and a send can reach the same phone at once. They share one create, and only the
      // first hears "newly added". A failed create is shared too, then forgotten, so the next call tries again.
      const inFlight = adding.get(phone);
      if (inFlight) return inFlight.then(() => false);
      const added = add(phone, name).finally(() => adding.delete(phone));
      adding.set(phone, added);
      return added;
    },
  };
}

// Terminal mode: nothing to register.
export const noContactRegistry: ContactRegistry = { ensure: async () => false };
