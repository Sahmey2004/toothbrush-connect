// /design — a living design sheet for "Fly Me to the Moon". Every screen here is rendered by the
// same components the app uses, fed with example data, inside device frames at 360, 390 and 430px.
import type { ReactNode } from "react";
import { BrushScreen, type BrushScreenProps } from "../components/brush/BrushScreen";
import { AudienceSheet, PickRow } from "../components/check-in/AudienceSheet";
import { AudienceChip } from "../components/check-in/AudienceChip";
import { MoodChips } from "../components/check-in/MoodChips";
import { SentPill, Snackbar } from "../components/check-in/Snackbar";
import { Avatar } from "../components/common/Avatar";
import { FeedView } from "../components/feed/FeedView";
import { MoodBadge } from "../components/feed/FriendCard";
import { Icon, ICON_NAMES } from "../components/icons/Icon";
import { JourneyView } from "../components/journey/JourneyView";
import { NavBar, type Tab } from "../components/layout/NavBar";
import { OverlapReactions } from "../components/presence/OverlapReactions";
import { BrushMoon } from "../components/timer/BrushMoon";
import { StartButton } from "../components/timer/StartButton";
import { DEMO_FLYING, DEMO_HOLDING, DEMO_MILESTONE } from "../lib/journey";
import { MOODS } from "../types/moods";
import type { FeedItem, FriendList } from "../types/api";

type Theme = "midnight" | "dawn";

const F = {
  sam: { id: "u-sam", name: "Sam" },
  priya: { id: "u-priya", name: "Priya" },
  marcus: { id: "u-marcus", name: "Marcus" },
  aisha: { id: "u-aisha", name: "Aisha" },
  tom: { id: "u-tom", name: "Tom" },
  jess: { id: "u-jess", name: "Jess" },
};
const FRIENDS = Object.values(F).map((f) => ({ friend_id: f.id, display_name: f.name }));
const LISTS: FriendList[] = [
  { id: "l-close", name: "Close 3", letter: "A", members: [F.sam.id, F.priya.id, F.marcus.id] },
  { id: "l-hs", name: "High school crew", letter: "B", members: [F.sam.id, F.marcus.id, F.aisha.id, F.tom.id] },
];

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const item = (id: string, who: { id: string; name: string }, mood: FeedItem["mood"], scope: FeedItem["scope"],
  text: string | null, audience: FeedItem["audience_label"], min: number, mine: FeedItem["my_reaction"] = null): FeedItem => ({
  check_in_id: id, author_id: who.id, author_name: who.name, mood, scope, text, audience_label: audience,
  delivered_at: ago(min), edited_at: null, seen_at: null, my_reaction: mine,
});
const FEED: FeedItem[] = [
  item("c1", F.priya, "stressful", "today", "moving apartments, send help", "just_for_you", 12),
  item("c2", F.aisha, "fun", "this_week", "got the job!!", "everyone", 40, "heart"),
  item("c3", F.marcus, "boring", "today", null, "close_circle", 130),
  item("c4", F.sam, "just_okay", "today", "long day, early night", "everyone", 200),
  item("c5", F.tom, "fun", "this_week", "kids finally asleep before nine", "close_circle", 60 * 26),
  item("c6", F.jess, "just_okay", "today", "first run since the marathon", "everyone", 60 * 27),
];

const noop = () => {};
const base: BrushScreenProps = {
  phase: "active", elapsedMs: 45_000, brushingNow: [], cards: FEED.slice(0, 4),
  audienceLabel: "Everyone (6)", scope: "today", line: "", selectedMood: null,
};
const posted: BrushScreenProps = {
  ...base, elapsedMs: 52_000, selectedMood: "stressful", line: "moving boxes all day",
  snackbar: <Snackbar deliverAt={null} frozenLeftMs={24_000} audienceLabel="Everyone (6)" onUndo={noop} onChange={noop} />,
};

const SIZES = { s: { w: 360, h: 800 }, m: { w: 390, h: 844 }, l: { w: 430, h: 932 } };

function Device({ size = "s", theme = "midnight", nav, children }: {
  size?: keyof typeof SIZES; theme?: Theme; nav?: Tab | null; children: ReactNode;
}) {
  const { w, h } = SIZES[size];
  return (
    <div className="device sky" data-theme={theme} style={{ width: w, height: h }}>
      <div className="shell">
        <main className="shell__main">{children}</main>
        {nav !== undefined && <NavBar active={nav} />}
      </div>
    </div>
  );
}

function Frame({ n, title, note, size = "s", theme = "midnight", nav, children }: {
  n?: number; title: string; note?: string; size?: keyof typeof SIZES; theme?: Theme; nav?: Tab | null; children: ReactNode;
}) {
  const { w, h } = SIZES[size];
  return (
    <figure className="frame" style={{ width: w }}>
      <Device size={size} theme={theme} nav={nav}>{children}</Device>
      <figcaption>
        <span className="frame__title">{n !== undefined && <span className="frame__n">{n}</span>}{title}</span>
        <span className="frame__meta">{w} × {h} · {theme === "dawn" ? "Dawn" : "Midnight"}{note ? ` · ${note}` : ""}</span>
      </figcaption>
    </figure>
  );
}

function Spec({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`spec${wide ? " spec--wide" : ""}`}>
      <h3 className="spec__title">{title}</h3>
      <div className="spec__body">{children}</div>
    </section>
  );
}

const screens = {
  idle: <BrushScreen {...base} phase="idle" elapsedMs={0} />,
  active: <BrushScreen {...base} />,
  posted: <BrushScreen {...posted} />,
  sheet: (
    <BrushScreen {...posted} sheet={
      <AudienceSheet open initial={{ type: "list", listId: "l-close" }} friends={FRIENDS} lists={LISTS}
        confirmLabel="Done, send now" onClose={noop} onConfirm={noop} />
    } />
  ),
  buddy: (
    <BrushScreen {...base} elapsedMs={70_000} brushingNow={[F.sam, F.priya]}
      drifts={[{ key: "d1", fromId: F.sam.id, kind: "heart" }]} reactionSent="wave" />
  ),
  done: (
    <BrushScreen {...base} phase="done" elapsedMs={120_000} caughtUp={[F.priya, F.sam, F.marcus]}
      doneNote="Your stressful update went to Everyone (6)." />
  ),
  feed: <FeedView feed={FEED} loaded brushingNow={[F.sam]} onReact={async () => {}} />,
  left: <BrushScreen {...posted} hand="left" />,
  journeyHolding: <JourneyView j={DEMO_HOLDING} />,
  journeyFlying: <JourneyView j={DEMO_FLYING} />,
  journeyMilestone: <JourneyView j={DEMO_MILESTONE} />,
};

export default function DesignSheet() {
  return (
    <div className="gallery" data-theme="midnight">
      <header className="gallery__head">
        <p className="gallery__eyebrow">Toothbrush Connect · design sheet</p>
        <h1 className="gallery__title">Fly Me to the Moon</h1>
        <p className="gallery__lede">
          A calm, late-night lunar theme: a quiet sky from a bathroom window. The brush timer is the moon,
          waxing from new to full over two minutes. Every control lives in the bottom 45% of the screen.
          These frames are the live components with example data.
        </p>
      </header>

      <section className="gallery__section" aria-labelledby="g-screens">
        <h2 id="g-screens" className="gallery__h2">Screens at 360px · Midnight</h2>
        <div className="gallery__row">
          <Frame n={1} title="Idle, ready for liftoff" nav="brush">{screens.idle}</Frame>
          <Frame n={2} title="Session at 0:45, crescent">{screens.active}</Frame>
          <Frame n={3} title="Just posted, 30 s hold">{screens.posted}</Frame>
          <Frame n={4} title="Audience picker">{screens.sheet}</Frame>
          <Frame n={5} title="Brush Buddy overlap">{screens.buddy}</Frame>
          <Frame n={6} title="Session complete" nav="brush">{screens.done}</Frame>
          <Frame n={7} title="Feed" nav="feed">{screens.feed}</Frame>
          <Frame n={8} title="Just posted, left-handed" note="mirrored">{screens.left}</Frame>
        </div>
      </section>

      <section className="gallery__section" aria-labelledby="g-journey">
        <h2 id="g-journey" className="gallery__h2">Crew journey · fly me to the moon</h2>
        <div className="gallery__row">
          <Frame n={9} title="Holding: fuel waiting on you" nav="journey">{screens.journeyHolding}</Frame>
          <Frame n={10} title="Engines firing after you post" nav="journey">{screens.journeyFlying}</Frame>
          <Frame n={11} title="Milestone: patch earned" nav="journey">{screens.journeyMilestone}</Frame>
          <Frame title="Holding" theme="dawn" nav="journey">{screens.journeyHolding}</Frame>
        </div>
      </section>

      <section className="gallery__section" aria-labelledby="g-widths">
        <h2 id="g-widths" className="gallery__h2">Wider phones · 390px and 430px</h2>
        <div className="gallery__row">
          <Frame title="Idle" size="m" nav="brush">{screens.idle}</Frame>
          <Frame title="Just posted" size="m">{screens.posted}</Frame>
          <Frame title="Idle" size="l" nav="brush">{screens.idle}</Frame>
          <Frame title="Just posted" size="l">{screens.posted}</Frame>
        </div>
      </section>

      <section className="gallery__section" aria-labelledby="g-dawn">
        <h2 id="g-dawn" className="gallery__h2">Dawn · light mode</h2>
        <div className="gallery__row">
          <Frame title="Session at 0:45" theme="dawn">{screens.active}</Frame>
          <Frame title="Just posted" theme="dawn">{screens.posted}</Frame>
          <Frame title="Feed" theme="dawn" nav="feed">{screens.feed}</Frame>
        </div>
      </section>

      <section className="gallery__section" aria-labelledby="g-parts">
        <h2 id="g-parts" className="gallery__h2">Component sheet</h2>
        <div className="sheetgrid">
          <Spec title="Moon timer · five phases" wide>
            <div className="spec__moons">
              {[
                { ms: 0, t: "0:00 · New moon", mode: "active" as const },
                { ms: 30_000, t: "0:30 · Crescent, 25% lit" },
                { ms: 60_000, t: "1:00 · Half moon, 50% lit" },
                { ms: 90_000, t: "1:30 · Gibbous, 75% lit" },
                { ms: 120_000, t: "2:00 · Full moon, Done", mode: "done" as const },
              ].map((m) => (
                <figure key={m.ms} className="spec__moon">
                  <BrushMoon elapsedMs={m.ms} mode={m.mode ?? "active"} size={132} />
                  <figcaption>{m.t}</figcaption>
                </figure>
              ))}
            </div>
          </Spec>

          <Spec title="Mood chips · default, pressed, selected">
            <p className="spec__label">Default</p>
            <MoodChips onPick={noop} />
            <p className="spec__label">Pressed (Fun)</p>
            <MoodChips onPick={noop} pressed="fun" />
            <p className="spec__label">Selected (Stressful)</p>
            <MoodChips onPick={noop} selected="stressful" />
          </Spec>

          <Spec title="Badges, audience chip, launch pad">
            <div className="spec__inline">{MOODS.map((m) => <MoodBadge key={m.id} mood={m.id} />)}</div>
            <div className="spec__inline">
              <span className="badge">today</span><span className="badge">this week</span>
              <span className="badge">Everyone</span><span className="badge">Close circle</span><span className="badge badge--warm">Just for you</span>
            </div>
            <div className="spec__inline"><AudienceChip label="Everyone (6)" onOpen={noop} /><AudienceChip label="Close 3 (3)" onOpen={noop} /></div>
            <div className="spec__launch"><StartButton onStart={noop} busy={false} friendsBrushing={["Sam"]} /></div>
          </Spec>

          <Spec title="Snackbar and utility">
            <Snackbar deliverAt={null} frozenLeftMs={24_000} audienceLabel="Everyone (6)" onUndo={noop} onChange={noop} />
            <Snackbar deliverAt={null} frozenLeftMs={6_000} audienceLabel="Close 3 (3)" onUndo={noop} onChange={noop} />
            <SentPill audienceLabel="Close 3 (3)" onDelete={noop} />
            <div className="utility-row">
              <OverlapReactions name="Sam" onReact={noop} sent="heart" />
              <button className="end-btn"><Icon name="land" size={20} />End</button>
            </div>
          </Spec>

          <Spec title="Bottom sheet rows">
            <PickRow on onClick={noop} lead={<span className="pick__glyph"><Icon name="lists" size={20} /></span>} title="Close 3" sub="Sam, Priya, Marcus" />
            <PickRow on={false} onClick={noop} lead={<span className="pick__glyph"><Icon name="everyone" size={20} /></span>} title="Everyone" sub="All 6 friends" />
            <PickRow on={false} onClick={noop} lead={<Avatar id={F.aisha.id} name="Aisha" size={36} />} title="Aisha" />
            <PickRow on onClick={noop} lead={<Avatar id={F.tom.id} name="Tom" size={36} />} title="Tom" />
          </Spec>

          <Spec title="Bottom navigation · each tab active" wide>
            <div className="spec__navs">
              {(["feed", "friends", "brush", "journey", "settings"] as Tab[]).map((t) => (
                <div key={t} className="spec__nav sky"><NavBar active={t} /></div>
              ))}
            </div>
          </Spec>

          <Spec title="Icon set · 24px grid, 2px stroke, rounded caps and joins" wide>
            <ul className="spec__icons">
              {ICON_NAMES.map((n) => (
                <li key={n}><span className="spec__icon"><Icon name={n} size={32} /></span><code>{n}</code></li>
              ))}
            </ul>
          </Spec>

          <Spec title="Colour" wide>
            <ul className="spec__swatches">
              {[
                ["Sky top", "#0B1026"], ["Sky bottom", "#1A2150"], ["Lunar surface", "#E8E6DF"], ["Shadow side", "#2A3160"],
                ["Moonbeam gold", "#F2C572"], ["Stressful", "#E88A7A"], ["Fun", "#6FD3C1"], ["Boring", "#9A9CC8"], ["Just okay", "#C9D3E0"],
                ["Dawn top", "#EEF0FA"], ["Dawn bottom", "#FBEFE6"], ["Dawn gold", "#C98A1E"],
              ].map(([name, hex]) => (
                <li key={name}><span className="spec__swatch" style={{ background: hex }} />{name}<code>{hex}</code></li>
              ))}
            </ul>
          </Spec>
        </div>
      </section>
    </div>
  );
}
