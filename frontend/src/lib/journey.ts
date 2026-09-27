// "Fly me to the moon": the crew journey. Every update anyone in your crew posts adds fuel.
// On days you post, your engine fires and all the fuel waiting in the tank burns into distance.
// On days you don't, the rocket holds where it is: nothing drains, nothing resets.

export const MOON_KM = 384_400;
export const KM_PER_UPDATE = 4_000;

export interface Milestone {
  km: number;
  name: string;
  reward: string; // what the patch unlocks
}

export const MILESTONES: Milestone[] = [
  { km: 0, name: "Liftoff", reward: "Your crew's mission patch" },
  { km: 36_000, name: "Satellite belt", reward: "Aurora trail behind the brush-timer capsule" },
  { km: 100_000, name: "Deep space", reward: "Shooting stars in your night sky" },
  { km: 192_200, name: "Halfway", reward: "Earthrise: see home from your timer" },
  { km: 260_000, name: "Moon's pull", reward: "Gold rocket for the whole crew" },
  { km: 326_000, name: "Lunar orbit", reward: "Moon rings on the brush timer" },
  { km: MOON_KM, name: "Touchdown", reward: "Plant your crew's flag, then pick the next destination" },
];

export interface CrewMember { id: string; name: string; me?: boolean }

export type DayStatus = "flew" | "held" | "today";
export interface FlightDay {
  date: string;       // ISO date
  status: DayStatus;
  km: number;         // distance flown that day (0 when held)
  fuelers: string[];  // crew ids who posted that day
}

export interface Journey {
  crew: CrewMember[];
  km: number;               // distance flown so far
  tankKm: number;           // fuel waiting in the tank for your next check-in
  postedToday: boolean;     // have you fired the engine today?
  todayFuelers: string[];   // crew ids who posted today
  week: FlightDay[];        // the last 7 days, oldest first
  fullCrewDays: number;     // days everyone posted: each one is a bonus patch
}

export const progress = (j: Journey) => Math.min(1, j.km / MOON_KM);
export const nextMilestone = (km: number) => MILESTONES.find((m) => m.km > km) ?? null;
export const updatesTo = (fromKm: number, toKm: number) => Math.max(0, Math.ceil((toKm - fromKm) / KM_PER_UPDATE));
export const formatKm = (km: number) => `${Math.round(km).toLocaleString("en-US")} km`;

// ── Example data ─────────────────────────────────────────────────────────────────────────────

export const DEMO_CREW: CrewMember[] = [
  { id: "u-maya", name: "Maya", me: true },
  { id: "u-priya", name: "Priya" },
  { id: "u-tom", name: "Tom" },
  { id: "u-sam", name: "Sam" },
];

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const flew = (daysAgo: number, fuelers: string[]): FlightDay => ({ date: day(daysAgo), status: "flew", km: fuelers.length * KM_PER_UPDATE, fuelers });
const held = (daysAgo: number, fuelers: string[]): FlightDay => ({ date: day(daysAgo), status: "held", km: 0, fuelers });

const WEEK: FlightDay[] = [
  flew(6, ["u-maya", "u-priya", "u-tom", "u-sam"]),
  flew(5, ["u-maya", "u-priya", "u-sam"]),
  held(4, ["u-priya", "u-tom"]), // Maya skipped: their fuel waited and burned the next day
  flew(3, ["u-maya", "u-tom"]),
  flew(2, ["u-maya", "u-priya", "u-tom"]),
  held(1, ["u-sam"]),
];

// Holding: Priya and Tom have posted today, Maya hasn't yet.
export const DEMO_HOLDING: Journey = {
  crew: DEMO_CREW,
  km: 238_000,
  tankKm: 3 * KM_PER_UPDATE, // Sam's from yesterday, plus Priya's and Tom's today
  postedToday: false,
  todayFuelers: ["u-priya", "u-tom"],
  week: [...WEEK, { date: day(0), status: "today", km: 0, fuelers: ["u-priya", "u-tom"] }],
  fullCrewDays: 3,
};

// Flying: Maya posted, the engine burned the tank plus their own update.
export const DEMO_FLYING: Journey = {
  ...DEMO_HOLDING,
  km: DEMO_HOLDING.km + DEMO_HOLDING.tankKm + KM_PER_UPDATE,
  tankKm: 0,
  postedToday: true,
  todayFuelers: ["u-priya", "u-tom", "u-maya"],
  week: [...WEEK, { date: day(0), status: "flew", km: DEMO_HOLDING.tankKm + KM_PER_UPDATE, fuelers: ["u-priya", "u-tom", "u-maya"] }],
};

// Milestone moment: the burn carried the crew past the Moon's pull.
export const DEMO_MILESTONE: Journey = {
  ...DEMO_FLYING,
  km: 262_000,
};

// Touchdown: the last burn landed the crew on the moon.
export const DEMO_TOUCHDOWN: Journey = {
  ...DEMO_FLYING,
  km: MOON_KM,
};
