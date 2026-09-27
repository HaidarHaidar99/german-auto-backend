const { createClient } = require("@supabase/supabase-js");

const rawUrl = process.env.SUPABASE_URL;
if (!rawUrl) {
  console.warn("[Supabase Config] Warning: SUPABASE_URL is not defined in environment variables.");
}

// Ensure base project origin URL is used without trailing slashes or subpaths
let supabaseUrl = rawUrl;
try {
  if (rawUrl) {
    supabaseUrl = new URL(rawUrl).origin;
  }
} catch (err) {
  console.error("[Supabase Config] Error parsing SUPABASE_URL:", err.message);
}

// Prioritize privileged service role key on server-side
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseKey) {
  console.warn("[Supabase Config] Warning: Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is defined.");
}

const supabase = createClient(supabaseUrl || "", supabaseKey || "", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;