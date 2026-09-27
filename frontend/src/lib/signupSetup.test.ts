import { describe, expect, it } from "vitest";
import { setupFor } from "./signupSetup";

const google = { display_name: "Sahmey Raiyan Khan", email: "sahmey@example.com" };
const tz = "America/Chicago";

describe("setupFor", () => {
  it("uses the name and channel entered on the sign-up screens", () => {
    expect(setupFor(google, { name: "  Sahmey ", channel: "whatsapp" }, tz)).toEqual({
      name: "Sahmey",
      timezone: tz,
      brushTimes: ["morning", "night"],
      channel: "whatsapp",
    });
  });

  it("falls back to the Google name, then the email, and never sends an empty name", () => {
    expect(setupFor(google, null, tz).name).toBe("Sahmey Raiyan Khan");
    expect(setupFor({ display_name: "", email: "roy.k@example.com" }, { name: " " }, tz).name).toBe("roy.k");
    expect(setupFor({ display_name: "", email: null }, null, tz).name).toBe("Friend");
  });

  it("leaves the channel alone unless sign-up picked a real one", () => {
    expect(setupFor(google, null, tz).channel).toBeNull();
    expect(setupFor(google, { channel: "carrier-pigeon" }, tz).channel).toBeNull();
  });
});
