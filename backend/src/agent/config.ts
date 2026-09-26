// Agent settings, read from the environment here rather than in src/config.ts.
import { z } from "zod";

const schema = z.discriminatedUnion("AGENT_MODE", [
  // Print messages to stdout; no Photon account needed.
  z.object({ AGENT_MODE: z.literal("terminal") }),
  z.object({
    AGENT_MODE: z.literal("photon"),
    PHOTON_PROJECT_ID: z.string().min(1),
    PHOTON_PROJECT_SECRET: z.string().min(1),
  }),
]);

export type AgentConfig =
  | { mode: "terminal" }
  | { mode: "photon"; photon: { projectId: string; projectSecret: string } };

export function loadAgentConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const parsed = schema.safeParse({ ...env, AGENT_MODE: env.AGENT_MODE || "terminal" });
  if (!parsed.success) {
    throw new Error(`Invalid agent config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const c = parsed.data;
  return c.AGENT_MODE === "terminal"
    ? { mode: "terminal" }
    : { mode: "photon", photon: { projectId: c.PHOTON_PROJECT_ID, projectSecret: c.PHOTON_PROJECT_SECRET } };
}
