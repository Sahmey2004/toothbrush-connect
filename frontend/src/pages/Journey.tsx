import { Link, useSearchParams } from "react-router-dom";
import { PopJourney } from "../components/journey/PopJourney";
import { DEMO_FLYING, DEMO_HOLDING, DEMO_MILESTONE, DEMO_TOUCHDOWN } from "../lib/journey";

const STATES = [
  { id: "waiting", label: "Waiting", j: DEMO_HOLDING },
  { id: "flying", label: "Flying", j: DEMO_FLYING },
  { id: "milestone", label: "Milestone", j: DEMO_MILESTONE },
  { id: "touchdown", label: "Moon", j: DEMO_TOUCHDOWN },
] as const;

const pick = (demo: string | null) => STATES.find((s) => s.id === demo) ?? STATES[0];

// Crew journey ("fly me to the moon"). Runs on example data until the backend tracks crew
// distance; ?demo=flying, milestone or touchdown shows the other states.
export default function Journey() {
  const [params] = useSearchParams();
  return <PopJourney j={pick(params.get("demo")).j} />;
}

// /demo/journey: the same page in the pop shell with a state switcher, no sign-in needed.
export function JourneyDemo() {
  const [params] = useSearchParams();
  const current = pick(params.get("demo"));
  return (
    <>
      <nav className="pj-demo" aria-label="Demo state">
        {STATES.map((s) => (
          <Link key={s.id} to={`?demo=${s.id}`} replace className={"pj-demo__opt" + (s.id === current.id ? " is-active" : "")}
            aria-current={s.id === current.id ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>
      <PopJourney j={current.j} />
    </>
  );
}
