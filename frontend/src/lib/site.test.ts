import { describe, expect, it } from "vitest";
import { inviteUrl } from "./site";

describe("inviteUrl", () => {
  // Invite links are texted to friends, who can't open the dev server, so they always point at the public site.
  it("links to the invite page on the public website", () =>
    expect(inviteUrl("abc123")).toBe("https://toothbrush-connect.vercel.app/invite/abc123"));
});
