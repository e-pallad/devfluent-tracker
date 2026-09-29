import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { NextRequest } from "next/server"
import { POST, GET, DELETE } from "@/app/api/accountability/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { makePost } from "../helpers/make-request"
import { createTestUser, deleteTestUser } from "../helpers/test-user"

const ID_A = "test-acc-user-a"
const ID_B = "test-acc-user-b"
const EMAIL_A = `${ID_A}@test.devfluent`
const EMAIL_B = `${ID_B}@test.devfluent`

/** Both directions exist → the partnership is confirmed */
async function linkMutually() {
  await prisma.accountabilityPair.createMany({
    data: [
      { requesterId: ID_A, partnerId: ID_B },
      { requesterId: ID_B, partnerId: ID_A },
    ],
  })
}

async function cleanupPairs() {
  await prisma.accountabilityPair.deleteMany({
    where: { OR: [{ requesterId: ID_A }, { partnerId: ID_A }, { requesterId: ID_B }, { partnerId: ID_B }] },
  })
}

describe("Accountability routes", () => {
  beforeAll(async () => {
    await createTestUser(ID_A)
    await createTestUser(ID_B)
  })
  beforeEach(async () => {
    setTestUserId(ID_A)
    await cleanupPairs()
    // Reset daily logs for both users
    await prisma.dailyLog.deleteMany({ where: { userId: { in: [ID_A, ID_B] } } })
    // Accountability partners are Pro-only (admin-override tier, no Subscription row)
    await prisma.user.updateMany({
      where: { id: { in: [ID_A, ID_B] } },
      data: { totalXP: 0, level: 1, streak: 0, subscriptionTier: "PRO" },
    })
  })
  afterAll(async () => {
    await cleanupPairs()
    await deleteTestUser(ID_A)
    await deleteTestUser(ID_B)
  })

  // --- POST /api/accountability ---

  describe("POST /api/accountability", () => {
    it("returns 401 when unauthenticated", async () => {
      setTestUserId(null)
      const res = await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))
      expect(res.status).toBe(401)
    })

    it("returns 400 when partnerEmail is missing", async () => {
      const res = await POST(makePost("/api/accountability", {}))
      expect(res.status).toBe(400)
    })

    it("returns 400 when linking to own email", async () => {
      const res = await POST(makePost("/api/accountability", { partnerEmail: EMAIL_A }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/yourself/i)
    })

    it("returns 400 when linking to own email with different casing", async () => {
      const res = await POST(makePost("/api/accountability", { partnerEmail: EMAIL_A.toUpperCase() }))
      expect(res.status).toBe(400)
    })

    it("returns 403 for FREE users", async () => {
      await prisma.user.update({ where: { id: ID_A }, data: { subscriptionTier: "FREE" } })
      const res = await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))
      expect(res.status).toBe(403)
    })

    it("returns an identical response whether or not the email exists (no enumeration)", async () => {
      const unknown = await (await POST(makePost("/api/accountability", { partnerEmail: "nobody@example.com" }))).json()
      const known = await (await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))).json()
      expect(known).toEqual(unknown)
      expect(known).not.toHaveProperty("partnerName")
    })

    it("creates an invitation (one-directional pair)", async () => {
      const res = await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      const pair = await prisma.accountabilityPair.findFirst({
        where: { requesterId: ID_A, partnerId: ID_B },
      })
      expect(pair).not.toBeNull()
    })

    it("is idempotent — second link request does not create duplicate", async () => {
      await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))
      const res = await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))
      expect(res.status).toBe(200)

      const count = await prisma.accountabilityPair.count({
        where: { requesterId: ID_A, partnerId: ID_B },
      })
      expect(count).toBe(1)
    })
  })

  // --- GET /api/accountability ---

  describe("GET /api/accountability", () => {
    it("returns 401 when unauthenticated", async () => {
      setTestUserId(null)
      const res = await GET()
      expect(res.status).toBe(401)
    })

    it("returns 403 for FREE users", async () => {
      await prisma.user.update({ where: { id: ID_A }, data: { subscriptionTier: "FREE" } })
      const res = await GET()
      expect(res.status).toBe(403)
    })

    it("returns partner: null when no pair exists", async () => {
      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.partner).toBeNull()
      expect(body.incoming).toEqual([])
    })

    it("does not reveal the invitee's data before they accept", async () => {
      await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))

      const res = await GET()
      const body = await res.json()
      expect(body.partner).toBeNull()
    })

    it("shows the invitation to the invitee as an incoming request", async () => {
      await prisma.accountabilityPair.create({ data: { requesterId: ID_B, partnerId: ID_A } })

      const body = await (await GET()).json()
      expect(body.partner).toBeNull()
      expect(body.incoming).toHaveLength(1)
      expect(body.incoming[0].email).toBe(EMAIL_B)
    })

    it("links both users once the invitee adds the requester back", async () => {
      // B invites A, A accepts by adding B
      await prisma.accountabilityPair.create({ data: { requesterId: ID_B, partnerId: ID_A } })
      await POST(makePost("/api/accountability", { partnerEmail: EMAIL_B }))

      const asA = await (await GET()).json()
      expect(asA.partner.email).toBe(EMAIL_B)
      expect(asA.incoming).toEqual([])

      setTestUserId(ID_B)
      const asB = await (await GET()).json()
      expect(asB.partner.email).toBe(EMAIL_A)
    })

    it("returns partner data when a mutual pair exists", async () => {
      await linkMutually()

      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.partner).not.toBeNull()
      expect(body.partner.email).toBe(EMAIL_B)
      expect(body.partner).toHaveProperty("streak")
      expect(body.partner).toHaveProperty("level")
      expect(body.partner).toHaveProperty("totalXP")
      expect(body.partner).toHaveProperty("weeklyBlocks")
      expect(body.partner).toHaveProperty("weeklyGoal")
    })

    it("calculates partner weekly blocks from last 7 days of logs", async () => {
      await linkMutually()

      // Add 3 daily logs for B within the past 7 days
      for (let i = 0; i < 3; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        d.setHours(0, 0, 0, 0)
        await prisma.dailyLog.create({
          data: { userId: ID_B, date: d, blocksCompleted: 2 },
        })
      }

      const res = await GET()
      const body = await res.json()

      expect(body.partner.weeklyBlocks).toBe(6) // 3 days × 2 blocks
    })

    it("excludes logs older than 7 days from weekly count", async () => {
      await linkMutually()

      // 1 log today and 1 log 8 days ago (outside window)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const old = new Date()
      old.setDate(old.getDate() - 8)
      old.setHours(0, 0, 0, 0)

      await prisma.dailyLog.create({ data: { userId: ID_B, date: today, blocksCompleted: 3 } })
      await prisma.dailyLog.create({ data: { userId: ID_B, date: old, blocksCompleted: 10 } })

      const res = await GET()
      const body = await res.json()

      expect(body.partner.weeklyBlocks).toBe(3)
    })
  })

  // --- DELETE /api/accountability ---

  describe("DELETE /api/accountability", () => {
    it("returns 401 when unauthenticated", async () => {
      setTestUserId(null)
      const res = await DELETE()
      expect(res.status).toBe(401)
    })

    it("declines a single incoming request", async () => {
      const incoming = await prisma.accountabilityPair.create({ data: { requesterId: ID_B, partnerId: ID_A } })

      const res = await DELETE(new NextRequest(`http://localhost/api/accountability?requestId=${incoming.id}`, { method: "DELETE" }))
      expect(res.status).toBe(200)
      expect(await prisma.accountabilityPair.findUnique({ where: { id: incoming.id } })).toBeNull()
    })

    it("cannot decline someone else's invitation", async () => {
      // B → A invitation: only A (the invitee) may decline it
      const outgoing = await prisma.accountabilityPair.create({ data: { requesterId: ID_B, partnerId: ID_A } })
      setTestUserId(ID_B) // B is the requester, not the invitee

      await DELETE(new NextRequest(`http://localhost/api/accountability?requestId=${outgoing.id}`, { method: "DELETE" }))
      expect(await prisma.accountabilityPair.findUnique({ where: { id: outgoing.id } })).not.toBeNull()
    })

    it("works for FREE users (unlinking after a downgrade)", async () => {
      await linkMutually()
      await prisma.user.update({ where: { id: ID_A }, data: { subscriptionTier: "FREE" } })

      const res = await DELETE()
      expect(res.status).toBe(200)
      expect(await prisma.accountabilityPair.count({ where: { OR: [{ requesterId: ID_A }, { partnerId: ID_A }] } })).toBe(0)
    })

    it("removes the accountability pair and returns success", async () => {
      await linkMutually()

      const res = await DELETE()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      const pair = await prisma.accountabilityPair.findFirst({
        where: { OR: [{ requesterId: ID_A }, { partnerId: ID_A }] },
      })
      expect(pair).toBeNull()
    })

    it("returns success even when no pair exists", async () => {
      const res = await DELETE()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })
  })
})
