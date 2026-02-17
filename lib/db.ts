import { neon } from "@neondatabase/serverless"

/**
 * Server-only database client using Neon serverless driver.
 *
 * IMPORTANT: This client should ONLY be used in:
 * - API routes (app/api/**)
 * - Server-side utilities imported by API routes
 *
 * NEVER import this in client components or pages.
 */

function getDatabaseUrl(): string {
  // Support both NEON_DATABASE_URL (Vercel integration) and DATABASE_URL (standard)
  const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEON_DATABASE_URL or DATABASE_URL is not configured")
    }
    // Return a placeholder for build time
    return "postgresql://placeholder:placeholder@placeholder/placeholder"
  }
  return url
}

// Create the SQL function
const rawSql = neon(getDatabaseUrl())

/**
 * Tagged template literal for SQL queries.
 * Returns an array of row objects.
 *
 * Usage:
 *   const users = await sql`SELECT * FROM users`
 *   const [user] = await sql`SELECT * FROM users WHERE id = ${id}`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<any[]> {
  return rawSql(strings, ...values)
}

// Helper to format Postgres errors
export function formatDbError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    // Extract Postgres error code if present
    const pgError = error as Error & { code?: string }
    return {
      message: pgError.message,
      code: pgError.code,
    }
  }
  return { message: String(error) }
}
