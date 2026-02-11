import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase client using the service role key.
 *
 * IMPORTANT: This client bypasses RLS and should ONLY be used in:
 * - API routes (app/api/**)
 * - Server-side utilities imported by API routes
 *
 * NEVER import this in client components or pages.
 *
 * The service role key has full database access, so security is enforced
 * by our password-protected middleware on API routes.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Validate we have the service role key at runtime (not build time)
function createAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    // During build, return a placeholder client
    // At runtime, this would be an error
    if (process.env.NODE_ENV === 'production' && typeof window === 'undefined') {
      console.warn('Supabase admin client: Missing credentials')
    }
    return createClient('https://placeholder.supabase.co', 'placeholder-key')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

export const supabaseAdmin = createAdminClient()

// Re-export as 'supabase' for easier migration (same import name)
export const supabase = supabaseAdmin
