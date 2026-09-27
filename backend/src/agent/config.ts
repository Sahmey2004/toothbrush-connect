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

type Env = Record<string, string | undefined>;

function fail(error: z.ZodError): never {
  throw new Error(`Invalid agent config: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
}

export function loadAgentConfig(env: Env = process.env): AgentConfig {
  const parsed = schema.safeParse({ ...env, AGENT_MODE: env.AGENT_MODE || "terminal" });
  if (!parsed.success) fail(parsed.error);
  const c = parsed.data;
  return c.AGENT_MODE === "terminal"
    ? { mode: "terminal" }
    : { mode: "photon", photon: { projectId: c.PHOTON_PROJECT_ID, projectSecret: c.PHOTON_PROJECT_SECRET } };
}

const dbSchema = z.object({
  SUPABASE_URL: z.url(),
  // Supabase "secret" key (sb_secret_…) or the legacy service_role JWT. Not the publishable key.
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1)
    .refine((k) => !k.startsWith("sb_publishable_"), "needs the secret (service role) key, not the publishable key"),
  SITE_URL: z.url(),
});

export interface DatabaseConfig {
  db: { url: string; secretKey: string };
  siteUrl: string;
}

// For main.ts. Falls back to the frontend's variable names so one .env serves both.
export function loadDatabaseConfig(env: Env = process.env): DatabaseConfig {
  const parsed = dbSchema.safeParse({
    SUPABASE_URL: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    SITE_URL: env.SITE_URL || env.FRONTEND_ORIGIN || "http://localhost:5173",
  });
  if (!parsed.success) fail(parsed.error);
  const c = parsed.data;
  return { db: { url: c.SUPABASE_URL, secretKey: c.SUPABASE_SECRET_KEY }, siteUrl: c.SITE_URL.replace(/\/$/, "") };
}
