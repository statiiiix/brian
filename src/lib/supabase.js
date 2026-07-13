import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey =
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  process.env.REACT_APP_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

// Keep a client available in unconfigured local/test environments so the app
// can render a useful setup error instead of crashing during module loading.
// The placeholder client never carries a production credential.
export const supabase = createClient(
  supabaseUrl || 'http://127.0.0.1:54321',
  supabaseKey || 'brian-local-unconfigured',
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);

export const BRIAN_MCP_URL =
  process.env.REACT_APP_BRIAN_MCP_URL || 'https://api.brianthebrain.app/mcp';
