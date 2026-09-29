import type { NextRequest } from "next/server"

// Routes validate each field they read, so the body is loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonBody = Record<string, any>

/**
 * Parse a JSON object request body. Returns null for a missing, malformed, or
 * non-object body so routes can answer 400 instead of throwing a 500.
 */
export async function readJson(req: NextRequest): Promise<JsonBody | null> {
  try {
    const body: unknown = await req.json()
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as JsonBody) : null
  } catch {
    return null
  }
}

export const INVALID_JSON = { error: "Request body must be a JSON object" }
