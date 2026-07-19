import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  console.warn("AtlasMind: Supabase env vars missing — persistence will be disabled");
}

export const supabaseReady = Boolean(url && anonKey);

// Use a stub when env vars are missing so importing this module never throws.
export const supabase: any = supabaseReady
  ? createClient(url, anonKey, { auth: { persistSession: false } })
  : new Proxy(
      {},
      {
        get() {
          throw new Error("Supabase is not configured");
        },
      },
    );
