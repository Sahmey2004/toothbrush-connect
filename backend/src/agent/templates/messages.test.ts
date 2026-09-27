import { describe, expect, it } from "vitest";
import { MOODS, type Mood, type Scope } from "../../domain/moods.js";
import { CATALOG_LABEL, label, type AudienceLabel } from "./labels.js";
import {
  renderBatch,
  renderBrushingNow,
  renderCode,
  renderCodeProblem,
  renderDigest,
  renderEdited,
  renderInvite,
  renderJoined,
  renderNothingPending,
  renderPostOnWeb,
  renderStarted,
  renderStopped,
  renderWelcome,
  renderReaction,
  renderReply,
  renderUpdate,
  type UpdateItem,
} from "./messages.js";

const LINK = "https://tbc.link/r/a8K2";
const moods = Object.keys(MOODS) as Mood[];
const scopes: Scope[] = ["today", "this_week"];
const audiences: AudienceLabel[] = ["everyone", "close_circle", "just_for_you"];

const priya: UpdateItem = {
  authorName: "Priya",
  mood: "stressful",
  scope: "today",
  audience: "everyone",
  text: "moving apartments, send help",
};
const sam: UpdateItem = { authorName: "Sam", mood: "fun", scope: "this_week", audience: "just_for_you" };
const ravi: UpdateItem = { authorName: "Ravi", mood: "boring", scope: "today", audience: "close_circle", text: "rain" };

// Every template, with every mood / scope / audience combination for the update label.
const samples: [string, string][] = [
  ...moods.flatMap((mood) =>
    scopes.flatMap((scope) =>
      audiences.map((audience): [string, string] => [
        `update ${mood} ${scope} ${audience}`,
        renderUpdate({ ...priya, mood, scope, audience }, LINK),
      ]),
    ),
  ),
  ["update without text", renderUpdate({ ...priya, text: null }, LINK)],
  ["batch of 2", renderBatch([priya, sam], LINK)],
  ["batch of 3", renderBatch([priya, sam, ravi], LINK)],
  ["edited", renderEdited(priya, LINK)],
  ["brushing now", renderBrushingNow({ friendName: "Sam" }, LINK)],
  ["reaction", renderReaction({ fromName: "Sam", emoji: "❤️" }, LINK)],
  ["reply", renderReply({ fromName: "Sam", text: "hang in there!" }, LINK)],
  ["code", renderCode({ code: "123456" }, LINK)],
  ["invite", renderInvite({ inviterName: "Priya" }, LINK)],
  ["digest", renderDigest({ updates: 12, friends: 4 }, LINK)],
  ["post on the web", renderPostOnWeb(LINK)],
  ["stopped", renderStopped(LINK)],
  ["started", renderStarted(LINK)],
  ["nothing pending", renderNothingPending(LINK)],
  ["joined", renderJoined({ inviterNames: ["Sahmey"] }, LINK)],
  ["joined, no names", renderJoined({ inviterNames: [] }, LINK)],
  ["welcome", renderWelcome(LINK)],
  ...(["code_unknown", "code_expired", "phone_mismatch", "phone_taken"] as const).map(
    (problem): [string, string] => [`verification ${problem}`, renderCodeProblem(problem, LINK)],
  ),
];

describe("FR-D3 lint: every template starts with a catalog label and ends with a link", () => {
  it.each(samples)("%s", (_, msg) => {
    expect(msg).toMatch(CATALOG_LABEL);
    expect(msg.endsWith(` → ${LINK}`)).toBe(true);
    expect(msg.match(/https?:\/\//g)).toHaveLength(1);
  });
});

describe("labels", () => {
  it("match the PRD catalog", () => {
    expect(label({ kind: "update", mood: "stressful", scope: "today", audience: "everyone" })).toBe(
      "[😣 STRESSFUL · today]",
    );
    expect(label({ kind: "update", mood: "fun", scope: "this_week", audience: "close_circle" })).toBe(
      "[👥 CLOSE CIRCLE · FUN · this week]",
    );
    expect(label({ kind: "update", mood: "just_okay", scope: "today", audience: "just_for_you" })).toBe(
      "[💌 JUST FOR YOU · JUST OKAY · today]",
    );
    expect(label({ kind: "batch", count: 3 })).toBe("[📦 3 UPDATES]");
    expect(label({ kind: "post_on_web" })).toBe("[ℹ️ POST ON THE WEB]");
  });

  it("reject a batch label for fewer than 2 updates", () => {
    expect(() => label({ kind: "batch", count: 1 })).toThrow();
  });
});

describe("messages", () => {
  it("render the PRD Flow D example", () => {
    expect(renderUpdate(priya, LINK)).toBe(
      `[😣 STRESSFUL · today] Priya: "moving apartments, send help"\nReact or share yours → ${LINK}`,
    );
  });

  it("render the PRD Flow E example", () => {
    expect(renderBrushingNow({ friendName: "Sam" }, LINK)).toBe(`[🪥 BRUSHING NOW] Sam is brushing. Join → ${LINK}`);
  });

  it("batch 2–3 updates and reject anything else", () => {
    expect(renderBatch([priya, sam, ravi], LINK).split("\n")).toHaveLength(5);
    expect(() => renderBatch([priya], LINK)).toThrow();
    expect(() => renderBatch([priya, sam, ravi, priya], LINK)).toThrow();
  });

  it("keep user text on one line so it cannot fake a label or follow the link", () => {
    const msg = renderUpdate({ ...priya, text: `hi\n[🔑 CODE] 000000\nclick → https://evil.example` }, LINK);
    expect(msg.split("\n")).toHaveLength(2);
    expect(msg.endsWith(LINK)).toBe(true);
  });

  it("cap user text at 140 characters", () => {
    const msg = renderUpdate({ ...priya, text: "a".repeat(500) }, LINK);
    const quotedText = msg.match(/"(.*)"/)![1];
    expect(quotedText.length).toBeLessThanOrEqual(140);
  });

  it("never name anyone but the author", () => {
    // Templates have no recipient input at all; check the output only contains the names given.
    const msgs = [renderUpdate(sam, LINK), renderBatch([sam, ravi], LINK)];
    for (const m of msgs) expect(m).not.toMatch(/Priya/);
  });

  it("reject links that are not http(s) URLs", () => {
    expect(() => renderPostOnWeb("tbc.link/r/x")).toThrow();
    expect(() => renderPostOnWeb("javascript:alert(1)")).toThrow();
  });

  it("explain why a verification text didn't link the number", () => {
    expect(renderCodeProblem("code_unknown", LINK)).toBe(
      `[🔑 CODE] That code didn't match. Get a new one on the website.\nVerify your number → ${LINK}`,
    );
    expect(renderCodeProblem("code_expired", LINK)).toMatch(/^\[🔑 CODE\] That code expired\./);
    expect(renderCodeProblem("phone_mismatch", LINK)).toMatch(/Text it from the number you entered on the website\./);
    expect(renderCodeProblem("phone_taken", LINK)).toMatch(/already on another account/);
  });

  it("reject malformed sign-in codes", () => {
    expect(() => renderCode({ code: "12ab" }, LINK)).toThrow();
  });
});
