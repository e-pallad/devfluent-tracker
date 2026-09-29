import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import { GET, POST } from "@/app/api/ai/recommendations/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { createTestUser, deleteTestUser } from "../helpers/test-user"

// Mutable reference so each beforeEach can supply a fresh vi.fn() with its own call count.
// The factory below captures this via closure and looks it up at call time (not factory time).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreate: any

vi.mock("@anthropic-ai/sdk", () => ({
  // Must use `function` (not arrow) so `new Anthropic()` works correctly as a constructor mock.
  default: vi.fn().mockImplementation(function () {
    return {
      messages: {
        // Indirect call: looks up `mockCreate` at call time, not at mock-factory time.
        create: (...args: unknown[]) => mockCreate(...args),
      },
    }
  }),
}))

const ID = "test-user-ai-recs"

const SAMPLE_RECS = [
  { title: "Practice daily", description: "Complete one block per day", priority: "high", icon: "🎯" },
  { title: "Review quizzes", description: "Redo any quiz under 70%", priority: "medium", icon: "📝" },
  { title: "Keep streak", description: "Log in every day this week", priority: "low", icon: "🔥" },
]

function makeClaudeResponse(recs: typeof SAMPLE_RECS) {
  return {
    content: [{ type: "text", text: JSON.stringify(recs) }],
  }
}

async function clearRecommendations() {
  await prisma.aiRecommendation.deleteMany({ where: { userId: ID } })
}

describe("AI recommendations routes", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => {
    setTestUserId(ID)
    await clearRecommendations()
    // AI coaching is Pro-only; admin-override tier (no Subscription row) keeps setup simple
    await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "PRO" } })
    // Fresh vi.fn() per test — call count always starts at 0
    mockCreate = vi.fn().mockResolvedValue(makeClaudeResponse(SAMPLE_RECS))
  })
  afterAll(async () => { await deleteTestUser(ID) })

  // --- GET /api/ai/recommendations ---

  describe("GET /api/ai/recommendations", () => {
    it("returns 401 when unauthenticated", async () => {
      setTestUserId(null)
      const res = await GET()
      expect(res.status).toBe(401)
    })

    it("calls Claude and returns recommendations when no cache exists", async () => {
      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.cached).toBe(false)
      expect(Array.isArray(body.recommendations)).toBe(true)
      expect(body.recommendations).toHaveLength(3)
      expect(mockCreate).toHaveBeenCalledOnce()
    })

    it("returns cached result without calling Claude when cache is valid", async () => {
      // Seed a valid cached recommendation (expires in 25 hours)
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + 25)
      await prisma.aiRecommendation.create({
        data: { userId: ID, content: JSON.stringify(SAMPLE_RECS), expiresAt },
      })

      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.cached).toBe(true)
      expect(body.recommendations).toEqual(SAMPLE_RECS)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it("regenerates when cache is expired", async () => {
      // Seed an expired cache (expired 1 hour ago)
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() - 1)
      await prisma.aiRecommendation.create({
        data: { userId: ID, content: JSON.stringify([]), expiresAt },
      })

      const res = await GET()
      const body = await res.json()

      expect(body.cached).toBe(false)
      expect(mockCreate).toHaveBeenCalledOnce()
    })

    it("stores new recommendations in the database", async () => {
      await GET()

      const record = await prisma.aiRecommendation.findUnique({ where: { userId: ID } })
      expect(record).not.toBeNull()
      expect(JSON.parse(record!.content)).toEqual(SAMPLE_RECS)
    })

    it("returns empty recommendations when Claude call fails", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API error"))

      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.recommendations).toEqual([])
      expect(body.cached).toBe(false)
    })

    it("returns 403 for FREE users without calling Claude", async () => {
      await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "FREE" } })

      const res = await GET()
      expect(res.status).toBe(403)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it("serves the previous recommendations when regeneration fails", async () => {
      await prisma.aiRecommendation.create({
        data: { userId: ID, content: JSON.stringify(SAMPLE_RECS), expiresAt: new Date(Date.now() - 1000) },
      })
      mockCreate.mockRejectedValueOnce(new Error("API error"))

      const res = await GET()
      const body = await res.json()
      expect(body.recommendations).toEqual(SAMPLE_RECS)
    })

    it("drops malformed items from Claude's reply", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: "text",
          text: JSON.stringify([
            SAMPLE_RECS[0],
            { title: "No priority", description: "x", icon: "❓" },
            "not an object",
            { title: "Bad priority", description: "x", priority: "urgent", icon: "❓" },
          ]),
        }],
      })

      const res = await GET()
      const body = await res.json()
      expect(body.recommendations).toEqual([SAMPLE_RECS[0]])
    })

    it("handles Claude response wrapped in markdown code fences", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "```json\n" + JSON.stringify(SAMPLE_RECS) + "\n```" }],
      })

      const res = await GET()
      const body = await res.json()

      expect(body.recommendations).toHaveLength(3)
    })

    it("returns empty recommendations when Claude response contains no JSON array", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "I cannot provide recommendations right now." }],
      })

      const res = await GET()
      const body = await res.json()

      expect(body.recommendations).toEqual([])
    })
  })

  // --- POST /api/ai/recommendations (force-refresh) ---

  describe("POST /api/ai/recommendations", () => {
    it("returns 401 when unauthenticated", async () => {
      setTestUserId(null)
      const res = await POST()
      expect(res.status).toBe(401)
    })

    it("always calls Claude even when a valid cache exists", async () => {
      // Seed a valid but old cache (generated 2 hours ago — bypasses the 1-hour rate limit)
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + 25)
      const generatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
      await prisma.aiRecommendation.create({
        data: { userId: ID, content: JSON.stringify(SAMPLE_RECS), expiresAt, generatedAt },
      })

      const res = await POST()
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.cached).toBe(false)
      expect(mockCreate).toHaveBeenCalledOnce()
    })

    it("returns 403 for FREE users without calling Claude", async () => {
      await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "FREE" } })

      const res = await POST()
      expect(res.status).toBe(403)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it("keeps the cached row (and its rate limit) when regeneration fails", async () => {
      const generatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
      await prisma.aiRecommendation.create({
        data: { userId: ID, content: JSON.stringify(SAMPLE_RECS), expiresAt: new Date(Date.now() + 1000 * 60 * 60), generatedAt },
      })
      mockCreate.mockRejectedValueOnce(new Error("API error"))

      const res = await POST()
      const body = await res.json()
      expect(body.recommendations).toEqual(SAMPLE_RECS)

      const record = await prisma.aiRecommendation.findUnique({ where: { userId: ID } })
      expect(record).not.toBeNull()
    })

    it("updates the cache record after force-refresh", async () => {
      const freshRecs = [{ title: "Fresh rec", description: "Fresh", priority: "high" as const, icon: "✨" }]
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify(freshRecs) }],
      })

      await POST()

      const record = await prisma.aiRecommendation.findUnique({ where: { userId: ID } })
      expect(record).not.toBeNull()
      expect(JSON.parse(record!.content)).toEqual(freshRecs)
    })
  })
})
