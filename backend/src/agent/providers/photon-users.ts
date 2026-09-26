// Photon project users. The shared iMessage line only talks to phone numbers listed under the project's
// Users, in both directions ("Target not allowed for this project" otherwise), so every registered phone is
// added here. Spectrum Cloud API: https://spectrum.photon.codes/openapi/json
import type { ContactRegistry } from "../ports.js";

const API = "https://spectrum.photon.codes";

// Area code 555 isn't a real North American area code; seed and test data use it. Registering those would only
// use up the plan's shared-user slots.
const isFictional = (phone: string) => phone.startsWith("+1555");

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

  async function listPhones(): Promise<Set<string>> {
    const res = await fetchImpl(base, { headers });
    if (!res.ok) throw new Error(`Photon list users: HTTP ${res.status}`);
    const body = (await res.json()) as { data: { users: { phoneNumber: string }[] } };
    return new Set(body.data.users.map((u) => u.phoneNumber));
  }

  return {
    async ensure(phone, name) {
      if (isFictional(phone)) return false;
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
        body: JSON.stringify({ type: "shared", phoneNumber: phone, firstName: name || null }),
      });
      if (res.status === 402) throw new PhotonPlanLimit("Photon plan's shared-user limit reached");
      if (!res.ok) throw new Error(`Photon create user: HTTP ${res.status} ${await res.text()}`);
      phones.add(phone);
      return true;
    },
  };
}

// Terminal mode: nothing to register.
export const noContactRegistry: ContactRegistry = { ensure: async () => false };
