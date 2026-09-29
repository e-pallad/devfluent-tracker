import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/user"
import { encryptTokenIfConfigured } from "@/lib/encryption"

function getAppOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // Fall through to request origin when env is invalid.
    }
  }
  // Do not trust forwarded headers — they can be client-influenced in pass-through
  // proxy configurations. NEXT_PUBLIC_APP_URL must be set in production.
  return req.nextUrl.origin
}

export async function GET(req: NextRequest) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const appOrigin = getAppOrigin(req)

  try {
    const user = await getCurrentUser()
    // Unauthorized — redirect to login (OAuth callback cannot return 401, must redirect)
    if (!user) {
      console.warn(`[github/callback:${reqId}] Unauthorized callback`)
      return NextResponse.redirect(new URL("/login", appOrigin))
    }

    const { searchParams } = req.nextUrl
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const storedState = req.cookies.get("github_oauth_state")?.value

    if (!code || !state || state !== storedState) {
      console.warn(`[github/callback:${reqId}] Invalid OAuth callback params`, {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasStoredState: Boolean(storedState),
        stateMatches: state === storedState,
      })
      return NextResponse.redirect(new URL("/settings?error=github_auth_failed", appOrigin))
    }

    // Exchange code for token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appOrigin}/api/auth/github/callback`,
      }),
    })
    if (!tokenRes.ok) {
      console.error(`[github/callback:${reqId}] Token exchange failed`, {
        status: tokenRes.status,
      })
      return NextResponse.redirect(new URL("/settings?error=github_token_failed", appOrigin))
    }
    const tokenData = await tokenRes.json() as { access_token?: string }
    const accessToken = tokenData.access_token
    if (!accessToken) {
      console.error(`[github/callback:${reqId}] Missing access token in token exchange response`)
      return NextResponse.redirect(new URL("/settings?error=github_token_failed", appOrigin))
    }

    // Fetch GitHub username
    const ghUserRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Devfluent" },
    })
    if (!ghUserRes.ok) {
      console.error(`[github/callback:${reqId}] GitHub user lookup failed`, {
        status: ghUserRes.status,
      })
      return NextResponse.redirect(new URL("/settings?error=github_user_failed", appOrigin))
    }
    const ghUser = await ghUserRes.json() as { login?: string }
    const githubUsername = ghUser.login
    if (!githubUsername) {
      console.error(`[github/callback:${reqId}] GitHub user response missing login`)
      return NextResponse.redirect(new URL("/settings?error=github_user_failed", appOrigin))
    }

    await prisma.user.update({
      where: { id: user.id },
      // Encrypted at rest when ENCRYPTION_KEY is set
      data: { githubUsername, githubAccessToken: encryptTokenIfConfigured(accessToken) },
    })

    console.info(`[github/callback:${reqId}] GitHub account connected`, {
      userId: user.id,
      githubUsername,
    })

    // Check if there's a stored next URL from the GitHub OAuth initiation
    const nextUrl = req.cookies.get("github_oauth_next")?.value
    const redirectUrl = nextUrl && nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : "/settings?github=connected"
    
    const res = NextResponse.redirect(new URL(redirectUrl, appOrigin))
    res.cookies.delete("github_oauth_state")
    res.cookies.delete("github_oauth_next")
    return res
  } catch (err) {
    console.error(`[github/callback:${reqId}] Unexpected callback failure`, err)
    return NextResponse.redirect(new URL("/settings?error=github_callback_error", appOrigin))
  }
}
