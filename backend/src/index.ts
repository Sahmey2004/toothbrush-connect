// Backend entry: runs the messaging agent (src/agent/main.ts). Everything else (auth, data, the 30 s hold) is
// Supabase. AGENT_MODE=photon sends through Photon; the default, terminal, prints messages instead.
import "./agent/main.js";
