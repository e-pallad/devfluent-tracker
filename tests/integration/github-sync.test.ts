import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, afterEach } from "vitest"
import { POST, DELETE } from "@/app/api/github/sync/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { createTestUser, deleteTestUser } from "../helpers/test-user"
import { encryptToken } from "@/lib/encryption"

const ID = "test-user-github-sync"

// Helper: build a minimal GitHub API event object
function makeEvent(
  id: string,
  type: "PushEvent" | "PullRequestEvent",
  daysAgo = 1,
  payload?: { action?: string; pull_request?: { merged?: boolean } }
) {
  const created = new Date()
  created.setDate(created.getDate() - daysAgo)
  return { id, type, created_at: created.toISOString(), payload }
}

// Stub global fetch to return a single page of events (< 100 → pagination stops)
function stubFetch(events: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => events,
    })
  )
}

async function connectGithub() {
  await prisma.user.update({
    where: { id: ID },
    data: { githubUsername: "gh-testuser", githubAccessToken: "test-token" },
  })
}

async function resetGithubUser() {
  await prisma.githubEvent.deleteMany({ where: { userId: ID } })
  await prisma.user.update({
    where: { id: ID },
    data: { totalXP: 0, level: 1, streak: 0, githubUsername: null, githubAccessToken: null, githubLastSyncAt: null },
  })
}

describe("GitHub sync routes", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => { setTestUserId(ID); await resetGithubUser() })
  afterEach(() => { vi.unstubAllGlobals() })
  afterAll(async () => { await deleteTestUser(ID) })

  // --- POST /api/github/sync ---

  describe("POST /api/github/sync", () => {
    it("returns 401 when unauthenticated", async () => {
      setTestUserId(null)
      const res = await POST()
      expect(res.status).toBe(401)
    })

    it("returns 400 when GitHub is not connected", async () => {
      // User has no githubUsername/githubAccessToken
      const res = await POST()
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/not connected/i)
    })

    it("awards GITHUB_PUSH XP (5) for a PushEvent", async () => {
      await connectGithub()
      stubFetch([makeEvent("push-1", "PushEvent")])

      const res = await POST()
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.newEvents).toBe(1)
      expect(body.totalXPAwarded).toBe(5)

      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(5)
    })

    it("awards GITHUB_PR_OPENED XP (10) for an opened PullRequestEvent", async () => {
      await connectGithub()
      stubFetch([makeEvent("pr-1", "PullRequestEvent", 1, { action: "opened" })])

      const res = await POST()
      const body = await res.json()

      expect(body.totalXPAwarded).toBe(10)
    })

    it("awards GITHUB_PR_MERGED XP (20) for a merged PullRequestEvent", async () => {
      await connectGithub()
      stubFetch([
        makeEvent("pr-2", "PullRequestEvent", 1, {
          action: "closed",
          pull_request: { merged: true },
        }),
      ])

      const res = await POST()
      const body = await res.json()

      expect(body.totalXPAwarded).toBe(20)
    })

    it("skips a closed (non-merged) PullRequestEvent", async () => {
      await connectGithub()
      stubFetch([
        makeEvent("pr-3", "PullRequestEvent", 1, {
          action: "closed",
          pull_request: { merged: false },
        }),
      ])

      const res = await POST()
      const body = await res.json()

      expect(body.newEvents).toBe(0)
      expect(body.totalXPAwarded).toBe(0)
    })

    it("skips events older than 30 days", async () => {
      await connectGithub()
      stubFetch([makeEvent("old-push-1", "PushEvent", 31)])

      const res = await POST()
      const body = await res.json()

      expect(body.newEvents).toBe(0)
      expect(body.totalXPAwarded).toBe(0)
    })

    it("does not double-award XP for the same event (idempotency)", async () => {
      await connectGithub()
      const events = [makeEvent("push-idem-1", "PushEvent")]
      stubFetch(events)

      await POST()
      vi.unstubAllGlobals()
      stubFetch(events)
      const res = await POST()
      const body = await res.json()

      // Second sync: event already recorded, no new XP
      expect(body.newEvents).toBe(0)
      expect(body.totalXPAwarded).toBe(0)

      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(5) // only from first sync
    })

    it("does not double-award XP when two syncs run concurrently", async () => {
      await connectGithub()
      stubFetch([makeEvent("push-race-1", "PushEvent"), makeEvent("push-race-2", "PushEvent")])

      const bodies = await Promise.all([POST(), POST()].map(async (p) => (await p).json()))
      expect(bodies.reduce((sum, b) => sum + b.totalXPAwarded, 0)).toBe(10)
      expect(bodies.reduce((sum, b) => sum + b.newEvents, 0)).toBe(2)

      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(10)
    })

    describe("with ENCRYPTION_KEY configured", () => {
      const original = process.env.ENCRYPTION_KEY
      beforeEach(() => { process.env.ENCRYPTION_KEY = "b".repeat(64) })
      afterEach(() => {
        if (original === undefined) delete process.env.ENCRYPTION_KEY
        else process.env.ENCRYPTION_KEY = original
      })

      function authHeaderOfFirstFetch(): string {
        const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
        return (init.headers as Record<string, string>).Authorization
      }

      it("decrypts an encrypted token before calling GitHub", async () => {
        await prisma.user.update({
          where: { id: ID },
          data: { githubUsername: "gh-testuser", githubAccessToken: encryptToken("gho_encrypted") },
        })
        stubFetch([])

        const res = await POST()
        expect(res.status).toBe(200)
        expect(authHeaderOfFirstFetch()).toBe("Bearer gho_encrypted")
      })

      it("still works with a legacy plaintext token (e.g. saved by GitHub sign-in)", async () => {
        await connectGithub() // stores "test-token" unencrypted
        stubFetch([])

        const res = await POST()
        expect(res.status).toBe(200)
        expect(authHeaderOfFirstFetch()).toBe("Bearer test-token")
      })
    })

    it("creates a GithubEvent record for each new event", async () => {
      await connectGithub()
      stubFetch([makeEvent("push-rec-1", "PushEvent")])

      await POST()

      const record = await prisma.githubEvent.findUnique({
        where: { userId_eventId: { userId: ID, eventId: "push-rec-1" } },
      })
      expect(record).not.toBeNull()
      expect(record!.eventType).toBe("PushEvent")
      expect(record!.xpAwarded).toBe(5)
    })

    it("updates githubLastSyncAt timestamp", async () => {
      await connectGithub()
      stubFetch([])

      await POST()

      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.githubLastSyncAt).not.toBeNull()
    })

    it("handles multiple events in one sync", async () => {
      await connectGithub()
      stubFetch([
        makeEvent("push-m1", "PushEvent"),
        makeEvent("pr-m1", "PullRequestEvent", 1, { action: "opened" }),
        makeEvent("pr-m2", "PullRequestEvent", 2, { action: "closed", pull_request: { merged: true } }),
      ])

      const res = await POST()
      const body = await res.json()

      // 5 + 10 + 20 = 35
      expect(body.newEvents).toBe(3)
      expect(body.totalXPAwarded).toBe(35)
    })
  })

  // --- DELETE /api/github/sync ---

  describe("DELETE /api/github/sync", () => {
    it("returns 401 when unauthenticated", async () => {
      setTestUserId(null)
      const res = await DELETE()
      expect(res.status).toBe(401)
    })

    it("clears github credentials and returns success", async () => {
      await connectGithub()

      const res = await DELETE()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.githubUsername).toBeNull()
      expect(user!.githubAccessToken).toBeNull()
      expect(user!.githubLastSyncAt).toBeNull()
    })
  })
})
