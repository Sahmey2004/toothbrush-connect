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
});

export interface DatabaseConfig {
  db: { url: string; secretKey: string };
  siteUrl: string;
}

// The website that links in texts open. People open them on their phones, so it's the public site even when the
// agent runs on a laptop; set SITE_URL only for another deploy (or a dev server in terminal mode).
export const PUBLIC_SITE_URL = "https://toothbrush-connect.vercel.app";

export function loadSiteUrl(env: Env = process.env): string {
  const parsed = z.url().safeParse(env.SITE_URL || PUBLIC_SITE_URL);
  if (!parsed.success) fail(parsed.error);
  const site = parsed.data.replace(/\/$/, "");
  if (env.AGENT_MODE === "photon" && ["localhost", "127.0.0.1"].includes(new URL(site).hostname)) {
    throw new Error(
      `Invalid agent config: SITE_URL is ${site}, but photon mode texts real phones. Leave SITE_URL unset for ` +
        `${PUBLIC_SITE_URL}, or set it to another public deploy`,
    );
  }
  return site;
}

// For main.ts. Falls back to the frontend's variable names so one .env serves both.
export function loadDatabaseConfig(env: Env = process.env): DatabaseConfig {
  const parsed = dbSchema.safeParse({
    SUPABASE_URL: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!parsed.success) fail(parsed.error);
  const c = parsed.data;
  return { db: { url: c.SUPABASE_URL, secretKey: c.SUPABASE_SECRET_KEY }, siteUrl: loadSiteUrl(env) };
}
