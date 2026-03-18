/**
 * Supabase client shared across API routes.
 *
 * Prefer the service-role key. If it is not configured, fall back to the anon
 * key so local development can still reach the database when RLS is not in the way.
 */

import '../env.js'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('[Supabase] SUPABASE_URL or Supabase key not set - DB calls will fail')
} else if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY) {
  console.warn('[Supabase] SUPABASE_SERVICE_ROLE_KEY not set - falling back to SUPABASE_ANON_KEY')
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-key',
  { auth: { persistSession: false } }
)
