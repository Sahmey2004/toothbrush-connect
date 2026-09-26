// Reads and validates environment variables.
import { z } from "zod";

const blank = (v: unknown) => (v === "" ? undefined : v);

const Schema = z.object({
  PHOTON_PROJECT_ID: z.preprocess(blank, z.string().optional()),
  PHOTON_PROJECT_SECRET: z.preprocess(blank, z.string().optional()),
  SITE_URL: z.preprocess(blank, z.string().url().default("http://localhost:5173")),
  AGENT_POLL_MS: z.preprocess(blank, z.coerce.number().int().positive().default(2000)),
  AGENT_DEV_PORT: z.preprocess(blank, z.coerce.number().int().positive().default(8787)),
});

export function loadConfig(env: Record<string, string | undefined>) {
  const c = Schema.parse(env);
  const photon = c.PHOTON_PROJECT_ID && c.PHOTON_PROJECT_SECRET
    ? { projectId: c.PHOTON_PROJECT_ID, projectSecret: c.PHOTON_PROJECT_SECRET }
    : null;
  return { photon, siteUrl: c.SITE_URL, pollMs: c.AGENT_POLL_MS, devPort: c.AGENT_DEV_PORT };
}
