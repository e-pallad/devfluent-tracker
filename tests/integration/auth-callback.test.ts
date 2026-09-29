import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest"
import { GET } from "@/app/api/auth/callback/route"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { createCallbackClient } from "@/lib/supabase/server"
import { createTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-auth-callback"

function makeGET(code: string | null, next?: string) {
  const url = new URL("http://localhost/api/auth/callback")
  if (code) url.searchParams.set("code", code)
  if (next) url.searchParams.set("next", next)
  return new NextRequest(url)
}

type MockOpts = {
  exchangeError?: boolean
  providerToken?: string | null
  userId?: string
  email?: string
}

function mockSupabaseClient(opts: MockOpts) {
  const user = {
    id: opts.userId ?? ID,
    email: opts.email ?? `${opts.userId ?? ID}@test.devfluent`,
    app_metadata: {},
    user_metadata: {
      full_name: "Test User",
      avatar_url: null,
    },
  }
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
      exchangeCodeForSession: vi.fn(async () => ({
        data: {
          session: opts.exchangeError
            ? null
            : { provider_token: opts.providerToken ?? null, user },
          user: opts.exchangeError ? null : user,
        },
        error: opts.exchangeError ? { message: "invalid_grant" } : null,
      })),
    },
  }
}

/** Stub global fetch to simulate GitHub API returning a valid user */
function stubGitHubAPI(login: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: login !== null,
      json: async () => (login ? { login } : {}),
    })
  )
}

/** Stub global fetch to simulate GitHub API returning a non-200 (non-GitHub token) */
function stubNonGitHubToken() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false })
  )
}

/**
 * The route persists GitHub credentials fire-and-forget, after the response is
 * returned. Poll for the row instead of sleeping a fixed time — under a loaded
 * CI runner a fixed 50 ms wait was not always enough.
 */
async function waitForGithubCredentials(userId: string) {
  return vi.waitFor(async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user?.githubAccessToken) throw new Error("GitHub credentials not persisted yet")
    return user
  }, { timeout: 5000, interval: 20 })
}

describe("GET /api/auth/callback", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => {
    await prisma.user.update({
      where: { id: ID },
      data: { githubUsername: null, githubAccessToken: null },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })
  afterAll(async () => { await deleteTestUser(ID) })

  // ─── redirect logic ────────────────────────────────────────────────────────

  it("redirects to /login?error=auth when no code param", async () => {
    const res = await GET(makeGET(null))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login?error=auth")
  })

  it("redirects to /login?error=auth when code exchange fails", async () => {
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({ exchangeError: true }) as unknown as ReturnType<typeof createCallbackClient>
    )
    const res = await GET(makeGET("bad-code"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login?error=auth")
  })

  it("redirects to /dashboard by default on success", async () => {
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({}) as unknown as ReturnType<typeof createCallbackClient>
    )
    const res = await GET(makeGET("valid-code"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toMatch(/\/dashboard$/)
  })

  it("honours a safe relative `next` param", async () => {
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({}) as unknown as ReturnType<typeof createCallbackClient>
    )
    const res = await GET(makeGET("valid-code", "/learning"))
    expect(res.headers.get("location")).toContain("/learning")
  })

  it("blocks open redirect: //evil.com falls back to /dashboard", async () => {
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({}) as unknown as ReturnType<typeof createCallbackClient>
    )
    const res = await GET(makeGET("valid-code", "//evil.com"))
    expect(res.headers.get("location")).toMatch(/\/dashboard$/)
  })

  // ─── GitHub credential upsert ──────────────────────────────────────────────

  it("does NOT upsert credentials when provider_token is absent (email login)", async () => {
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({ providerToken: null }) as unknown as ReturnType<typeof createCallbackClient>
    )
    await GET(makeGET("valid-code"))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.githubAccessToken).toBeNull()
  })

  it("does NOT upsert credentials when GitHub API rejects the token (non-GitHub provider)", async () => {
    stubNonGitHubToken()
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({ providerToken: "non-github-token" }) as unknown as ReturnType<typeof createCallbackClient>
    )
    await GET(makeGET("valid-code"))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.githubAccessToken).toBeNull()
  })

  it("upserts credentials when GitHub API confirms the token (first-time signup)", async () => {
    stubGitHubAPI("octocat")
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({
        providerToken: "gh-token-signup",
      }) as unknown as ReturnType<typeof createCallbackClient>
    )
    await GET(makeGET("valid-code"))
    const user = await waitForGithubCredentials(ID)
    expect(user.githubAccessToken).toBe("gh-token-signup")
    expect(user.githubUsername).toBe("octocat")
  })

  it("upserts credentials for email user who linked GitHub (GitHub API confirms token)", async () => {
    stubGitHubAPI("octocat-linked")
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({
        providerToken: "gh-token-linked",
      }) as unknown as ReturnType<typeof createCallbackClient>
    )
    await GET(makeGET("valid-code"))
    const user = await waitForGithubCredentials(ID)
    expect(user.githubAccessToken).toBe("gh-token-linked")
    expect(user.githubUsername).toBe("octocat-linked")
  })

  it("creates a new User row on first-ever GitHub login (upsert create path)", async () => {
    const NEW_ID = "test-user-auth-callback-new"
    try {
      stubGitHubAPI("newdev")
      vi.mocked(createCallbackClient).mockImplementationOnce(
        () => mockSupabaseClient({
          userId: NEW_ID,
          email: `${NEW_ID}@test.devfluent`,
          providerToken: "gh-new-token",
        }) as unknown as ReturnType<typeof createCallbackClient>
      )
      await GET(makeGET("valid-code"))
      const user = await waitForGithubCredentials(NEW_ID)
      expect(user.githubUsername).toBe("newdev")
      expect(user.githubAccessToken).toBe("gh-new-token")
    } finally {
      await prisma.user.deleteMany({ where: { id: NEW_ID } })
    }
  })

  it("does NOT upsert when GitHub API returns no login field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) // no `login` field
    )
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({
        providerToken: "gh-token-no-name",
      }) as unknown as ReturnType<typeof createCallbackClient>
    )
    await GET(makeGET("valid-code"))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.githubAccessToken).toBeNull()
  })

  it("does NOT upsert when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))
    vi.mocked(createCallbackClient).mockImplementationOnce(
      () => mockSupabaseClient({
        providerToken: "gh-token-network-fail",
      }) as unknown as ReturnType<typeof createCallbackClient>
    )
    await GET(makeGET("valid-code"))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.githubAccessToken).toBeNull()
  })
})
