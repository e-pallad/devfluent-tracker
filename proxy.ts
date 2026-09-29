import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { LOCALE_COOKIE, LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/config"
import { DEMO_SESSION_COOKIE } from "@/lib/demo"

const PUBLIC_PATHS = ["/", "/login", "/api/auth", "/api/webhooks/stripe", "/impressum", "/datenschutz", "/offline", "/sw.js", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/opengraph-image"]
const DEMO_ALLOWED_PATHS = ["/dashboard", "/learning", "/api/ai/recommendations", "/api/accountability", "/api/progress/block"]

function detectLocale(req: NextRequest): string {
  const accept = req.headers.get("accept-language") ?? ""
  for (const part of accept.split(",")) {
    const lang = part.trim().split(";")[0].trim().split("-")[0].toLowerCase()
    if ((LOCALES as readonly string[]).includes(lang)) return lang
  }
  return DEFAULT_LOCALE
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // Detect locale once; use the value directly rather than reading back from
  // req.cookies (which may not reflect the set() call in all runtimes).
  const existingLocale = req.cookies.get(LOCALE_COOKIE)
  const needsLocaleCookie = !existingLocale
  const localeValue = existingLocale?.value ?? detectLocale(req)

  if (needsLocaleCookie) {
    // Propagate into req.cookies so server components see it on this request.
    req.cookies.set(LOCALE_COOKIE, localeValue)
  }

  // Allow public paths (exact match for "/" to avoid bypassing all auth)
  if (PUBLIC_PATHS.some((p) => p === "/" ? pathname === "/" : pathname.startsWith(p))) {
    const res = NextResponse.next()
    if (needsLocaleCookie) {
      res.cookies.set(LOCALE_COOKIE, localeValue, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      })
    }
    return res
  }

  const isDemoSession = req.cookies.get(DEMO_SESSION_COOKIE)?.value === "1"
  if (isDemoSession) {
    if (DEMO_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      const res = NextResponse.next()
      if (needsLocaleCookie) {
        res.cookies.set(LOCALE_COOKIE, localeValue, {
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
          sameSite: "lax",
        })
      }
      return res
    }

    const dashboardUrl = new URL("/dashboard", req.url)
    const redirect = NextResponse.redirect(dashboardUrl)
    if (needsLocaleCookie) {
      redirect.cookies.set(LOCALE_COOKIE, localeValue, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      })
    }
    return redirect
  }

  const res = NextResponse.next()

  if (needsLocaleCookie) {
    res.cookies.set(LOCALE_COOKIE, localeValue, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Supabase may call setAll asynchronously via onAuthStateChange after
          // the proxy function has already returned a redirect. Wrap in try/catch
          // so a stale request/response object cannot cause an unhandled rejection
          // that crashes the Node.js process (502).
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              req.cookies.set(name, value)
              res.cookies.set(name, value, {
                ...options,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
              })
            })
          } catch {
            // Intentionally swallowed — called from an async onAuthStateChange
            // callback that fires after the proxy has returned; nothing to update.
          }
        },
      },
    }
  )

  let user
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (!user) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return res
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
