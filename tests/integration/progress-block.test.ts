import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { POST } from "@/app/api/progress/block/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { makePost } from "../helpers/make-request"
import { createTestUser, resetTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-block"
const BLOCK = "m1w1-b1" // real blockId from CURRICULUM

describe("POST /api/progress/block", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => { setTestUserId(ID); await resetTestUser(ID) })
  afterAll(async () => { await deleteTestUser(ID) })

  it("returns 401 when unauthenticated", async () => {
    setTestUserId(null)
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when blockId is missing", async () => {
    const res = await POST(makePost("/api/progress/block", { status: "COMPLETED" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid status value", async () => {
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "DONE" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid status.*Must be one of/)
  })

  it("returns 404 for unknown blockId", async () => {
    const res = await POST(makePost("/api/progress/block", { blockId: "m99w99-b99", status: "COMPLETED" }))
    expect(res.status).toBe(404)
  })

  it("completes a block, creates a BlockProgress record, and awards XP", async () => {
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.xpAwarded).toBe(10) // XP_VALUES.COMPLETE_BLOCK

    const bp = await prisma.blockProgress.findUnique({
      where: { userId_blockId: { userId: ID, blockId: BLOCK } },
    })
    expect(bp!.status).toBe("COMPLETED")

    // totalXP = 10 (block) + 10 (first_block achievement bonus)
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(20)
  })

  it("awards Pomodoro bonus XP when usedTimer is true", async () => {
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED", usedTimer: true }))
    const body = await res.json()
    expect(body.xpAwarded).toBe(15) // XP_VALUES.COMPLETE_BLOCK_POMODORO
  })

  it("does NOT double-award XP when completing an already-completed block", async () => {
    await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" }))
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" }))
    const body = await res.json()
    expect(body.xpAwarded).toBe(0)

    // After first completion: 10 (block) + 10 (first_block achievement) = 20
    // Second completion: xpAwarded=0, totalXP stays at 20
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(20)
  })

  it("awards SKIP_BLOCK XP (1) for skipped status", async () => {
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "SKIPPED" }))
    const body = await res.json()
    expect(body.xpAwarded).toBe(1)
  })

  it("awards SKIP_BLOCK XP only once when skipping repeatedly", async () => {
    await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "SKIPPED" }))
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "SKIPPED" }))
    const body = await res.json()
    expect(body.xpAwarded).toBe(0)
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(1)
  })

  it("still awards completion XP after a block was skipped", async () => {
    await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "SKIPPED" }))
    const res = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" }))
    const body = await res.json()
    expect(body.xpAwarded).toBe(10)
    const bp = await prisma.blockProgress.findUnique({
      where: { userId_blockId: { userId: ID, blockId: BLOCK } },
    })
    expect(bp!.xpEarned).toBe(11) // skip + completion, accumulated
  })

  it("does NOT re-award XP or goal progress for complete → skip → complete", async () => {
    await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" }))
    const skip = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "SKIPPED" }))
    expect((await skip.json()).xpAwarded).toBe(0)
    const again = await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" }))
    expect((await again.json()).xpAwarded).toBe(0)

    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(20) // 10 (block) + 10 (first_block achievement), once
    const logs = await prisma.dailyLog.findMany({ where: { userId: ID } })
    expect(logs.reduce((sum, l) => sum + l.blocksCompleted, 0)).toBe(1)
  })

  it("does NOT double-award XP for concurrent completions of the same block", async () => {
    const results = await Promise.all([
      POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" })),
      POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" })),
      POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED" })),
    ])
    const awarded = await Promise.all(results.map(async (r) => (await r.json()).xpAwarded))
    expect(awarded.filter((xp) => xp > 0)).toHaveLength(1)

    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(20) // 10 (block) + 10 (first_block achievement)
  })

  it("sanitizes negative minutesSpent to 0", async () => {
    await POST(makePost("/api/progress/block", { blockId: BLOCK, status: "COMPLETED", minutesSpent: -99 }))
    const bp = await prisma.blockProgress.findUnique({
      where: { userId_blockId: { userId: ID, blockId: BLOCK } },
    })
    expect(bp!.minutesSpent).toBe(0)
  })
})
