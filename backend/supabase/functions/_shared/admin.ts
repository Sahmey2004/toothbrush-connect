import { createClient } from "npm:@supabase/supabase-js@2";

// Service-role client: bypasses RLS, so only use it for the agent's own RPCs.
export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
