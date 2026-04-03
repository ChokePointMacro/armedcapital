import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client-side Supabase client (anon key — subject to RLS policies)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase client (use in API routes)
// Uses service_role key to bypass RLS — only call from trusted server code.
export function createServerSupabase() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.warn('[supabase] SUPABASE_SERVICE_ROLE_KEY not set, falling back to anon key');
    return createClient(supabaseUrl, supabaseAnonKey);
  }
  return createClient(supabaseUrl, serviceRoleKey);
}
