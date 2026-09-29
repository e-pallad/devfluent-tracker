import { NextRequest, NextResponse } from "next/server"
import { createCallbackClient } from "@/lib/supabase/server"
import { DEMO_SESSION_COOKIE } from "@/lib/demo"

// Resolve the canonical app origin so redirects always target the public
// domain (https://devfluent.de) and never the Docker-internal binding
// address (http://0.0.0.0:3000) that appears when Next.js standalone uses
// HOSTNAME=0.0.0.0 and req.url is constructed from the plain-HTTP side of the
// Nginx → container connection.
function getAppOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // Fall through to forwarded headers.
    }
  }
  // Trust X-Forwarded-Proto/Host forwarded by Nginx.
  const proto = req.headers.get("x-forwarded-proto") ?? "https"
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost"
  return `${proto}://${host}`
}

async function persistGithubCredentials(args: {
  userId: string
  email: string
  name: string | null
  avatarUrl: string | null
  githubUsername: string
  githubAccessToken: string
}) {
  // Optional enhancement only: never block auth callback on DB/env issues.
  if (!process.env.DATABASE_URL) return

  try {
    const { prisma } = await import("@/lib/prisma")
    const { encryptTokenIfConfigured } = await import("@/lib/encryption")
    // Same at-rest encryption as the "Connect GitHub" flow; sync decrypts either way
    const githubAccessToken = encryptTokenIfConfigured(args.githubAccessToken)
    await prisma.user.upsert({
      where: { id: args.userId },
      update: {
        githubUsername: args.githubUsername,
        githubAccessToken,
      },
      create: {
        id: args.userId,
        email: args.email,
        name: args.name,
        avatarUrl: args.avatarUrl,
        githubUsername: args.githubUsername,
        githubAccessToken,
      },
    })
  } catch (err) {
    console.error("[auth/callback] Failed to persist GitHub credentials:", err)
  }
}

export async function GET(req: NextRequest) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const nextParam = url.searchParams.get("next") ?? "/dashboard"
  const envSnapshot = {
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  }
  // Prevent open redirect: only allow relative paths
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard"
  const appOrigin = getAppOrigin(req)

  try {
    if (code) {
      // Collect cookies that Supabase wants to set so we can apply them
      // directly to the NextResponse.redirect() below.  Relying on
      // cookies() from next/headers is not reliable here because Next.js
      // does not guarantee that mutations staged via that API are flushed
      // into a manually-constructed NextResponse (as opposed to the
      // framework's own response pipeline).
      const pendingCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = []

      const supabase = createCallbackClient(req, pendingCookies)

      const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        // Build the redirect response and flush session cookies onto it
        // immediately — before any async side-effects — so the browser always
        // receives the Set-Cookie headers even if a background task takes time.
        const response = NextResponse.redirect(new URL(next, appOrigin))
        for (const { name, value, options } of pendingCookies) {
          response.cookies.set(name, value, {
            ...(options as Parameters<typeof response.cookies.set>[2]),
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
          })
        }
        response.cookies.delete(DEMO_SESSION_COOKIE)

        console.info(`[auth/callback:${reqId}] Auth callback success`, {
          hasSession: Boolean(session),
          hasProviderToken: Boolean(session?.provider_token),
          cookiesSet: pendingCookies.length,
          next,
          appOrigin,
        })

        // Fire-and-forget: persist GitHub credentials in the background so the
        // redirect is not blocked by the GitHub API call + DB write (avoids proxy timeout).
        if (session?.provider_token) {
          const providerToken = session.provider_token
          const userId = session.user.id
          const email = session.user.email
          const name = (session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? null) as string | null
          const avatarUrl = (session.user.user_metadata?.avatar_url ?? null) as string | null
          ;(async () => {
            try {
              const abort = new AbortController()
              const timeout = setTimeout(() => abort.abort(), 5000)
              const ghRes = await fetch("https://api.github.com/user", {
                headers: { Authorization: `Bearer ${providerToken}`, "User-Agent": "Devfluent" },
                signal: abort.signal,
              }).catch(() => null).finally(() => clearTimeout(timeout))
              if (ghRes?.ok) {
                const ghUser = await ghRes.json() as { login?: string }
                const githubUsername = ghUser.login
                if (githubUsername && email) {
                  await persistGithubCredentials({ userId, email, name, avatarUrl, githubUsername, githubAccessToken: providerToken })
                }
              } else {
                console.warn(`[auth/callback:${reqId}] provider_token did not resolve to GitHub user`)
              }
            } catch (err) {
              console.warn(`[auth/callback:${reqId}] Background credential sync failed`, err)
            }
          })()
        }

        return response
      }

      console.error(`[auth/callback:${reqId}] exchangeCodeForSession failed`, {
        message: error.message,
        status: error.status,
        env: envSnapshot,
      })
    } else {
      console.warn(`[auth/callback:${reqId}] Missing code query parameter`)
    }
  } catch (err) {
    console.error(`[auth/callback:${reqId}] Unexpected callback failure`, {
      error: err,
      env: envSnapshot,
      hasCode: Boolean(code),
      next,
    })
  }

  return NextResponse.redirect(new URL("/login?error=auth", appOrigin))
}
