import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { POST } from "@/app/api/progress/quiz/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { makePost } from "../helpers/make-request"
import { createTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-quiz"
const BLOCK = "m1w1-b1" // real curriculum block ID — quiz route now validates against curriculum

async function resetQuizUser() {
  await prisma.quizAttempt.deleteMany({ where: { userId: ID } })
  await prisma.achievement.deleteMany({ where: { userId: ID } })
  await prisma.user.update({
    where: { id: ID },
    data: { totalXP: 0, level: 1, streak: 0, lastSeenAt: null },
  })
}

describe("POST /api/progress/quiz", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => { setTestUserId(ID); await resetQuizUser() })
  afterAll(async () => { await deleteTestUser(ID) })

  // --- Authentication ---

  it("returns 401 when unauthenticated", async () => {
    setTestUserId(null)
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 80 }))
    expect(res.status).toBe(401)
  })

  // --- Input validation ---

  it("returns 400 when blockId is missing", async () => {
    const res = await POST(makePost("/api/progress/quiz", { score: 80 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/blockId/)
  })

  it("returns 400 when score is below 0", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: -1 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/score/)
  })

  it("returns 400 when score is above 100", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 101 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/score/)
  })

  it("returns 400 when score is a non-integer number", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 75.5 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/score/)
  })

  it("returns 400 when score is a string", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: "abc" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/score/)
  })

  // --- XP awards ---

  it("awards QUIZ_TRY XP only on a failing attempt (score < 70)", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 50 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // QUIZ_TRY = 3
    expect(body.xpEarned).toBe(3)
    expect(body.passed).toBe(false)
    expect(body.perfect).toBe(false)
  })

  it("awards QUIZ_TRY + QUIZ_PASS XP on a passing attempt (score >= 70)", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 80 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // QUIZ_TRY=3 + QUIZ_PASS=12 = 15
    expect(body.xpEarned).toBe(15)
    expect(body.passed).toBe(true)
    expect(body.perfect).toBe(false)
  })

  it("awards QUIZ_TRY + QUIZ_PASS + QUIZ_PERFECT XP on a perfect attempt (score = 100)", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // QUIZ_TRY=3 + QUIZ_PASS=12 + QUIZ_PERFECT=25 = 40
    expect(body.xpEarned).toBe(40)
    expect(body.passed).toBe(true)
    expect(body.perfect).toBe(true)
  })

  // --- passed / perfect boundary flags ---

  it("score=69 produces passed=false", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 69 }))
    const body = await res.json()
    expect(body.passed).toBe(false)
    expect(body.perfect).toBe(false)
  })

  it("score=70 produces passed=true", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 70 }))
    const body = await res.json()
    expect(body.passed).toBe(true)
    expect(body.perfect).toBe(false)
  })

  it("score=100 produces perfect=true", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))
    const body = await res.json()
    expect(body.perfect).toBe(true)
  })

  // --- Database record creation ---

  it("creates a QuizAttempt record in the database with correct fields", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 80 }))
    expect(res.status).toBe(200)
    const body = await res.json()

    const record = await prisma.quizAttempt.findFirst({
      where: { userId: ID, blockId: BLOCK },
    })
    expect(record).not.toBeNull()
    expect(record!.score).toBe(80)
    expect(record!.passed).toBe(true)
    expect(record!.perfect).toBe(false)
    expect(record!.xpEarned).toBe(15)
    expect(record!.id).toBe(body.attempt.id)
  })

  it("creates a QuizAttempt record for a perfect score with correct flags", async () => {
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))

    const record = await prisma.quizAttempt.findFirst({
      where: { userId: ID, blockId: BLOCK },
    })
    expect(record).not.toBeNull()
    expect(record!.score).toBe(100)
    expect(record!.passed).toBe(true)
    expect(record!.perfect).toBe(true)
    expect(record!.xpEarned).toBe(40)
  })

  // --- Achievements ---

  it("unlocks the 'first-quiz' achievement on the first quiz attempt", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 50 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.achievements.map((a: { slug: string }) => a.slug)).toContain("first-quiz")
  })

  it("does not re-unlock 'first-quiz' on a subsequent attempt", async () => {
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 50 }))
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 60 }))
    const body = await res.json()
    expect(body.achievements.map((a: { slug: string }) => a.slug)).not.toContain("first-quiz")
  })

  it("unlocks the 'perfect-score' achievement on a score of 100", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.achievements.map((a: { slug: string }) => a.slug)).toContain("perfect-score")
  })

  it("does not unlock 'perfect-score' on a passing but non-perfect score", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 90 }))
    const body = await res.json()
    expect(body.achievements.map((a: { slug: string }) => a.slug)).not.toContain("perfect-score")
  })

  // --- User XP reflected in database ---

  it("reflects QUIZ_TRY XP increase on the user record after a failed attempt", async () => {
    // QUIZ_TRY=3, first-quiz achievement bonus=10 → totalXP=13
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 50 }))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(13) // 3 (quiz) + 10 (first-quiz achievement)
  })

  it("reflects QUIZ_TRY + QUIZ_PASS XP on the user record after a passing attempt", async () => {
    // QUIZ_TRY=3 + QUIZ_PASS=12 = 15, first-quiz achievement bonus=10 → totalXP=25
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 80 }))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(25) // 15 (quiz) + 10 (first-quiz achievement)
  })

  it("reflects full XP on the user record after a perfect attempt", async () => {
    // QUIZ_TRY=3 + QUIZ_PASS=12 + QUIZ_PERFECT=25 = 40
    // first-quiz achievement bonus=10, perfect-score achievement bonus=25 → totalXP=75
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(75) // 40 (quiz) + 10 (first-quiz) + 25 (perfect-score)
  })

  // --- One-time XP per quiz ---

  it("awards no XP when retaking a quiz with the same result", async () => {
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))
    const body = await res.json()
    expect(body.xpEarned).toBe(0)
    expect(body.passed).toBe(true)
    expect(body.perfect).toBe(true)

    // Retake is still recorded, with the XP it actually earned
    const attempts = await prisma.quizAttempt.findMany({
      where: { userId: ID, blockId: BLOCK },
      orderBy: { attemptedAt: "asc" },
    })
    expect(attempts).toHaveLength(2)
    expect(attempts[1].xpEarned).toBe(0)
  })

  it("awards only the pass bonus when passing after a failed attempt", async () => {
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 40 }))
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 80 }))
    const body = await res.json()
    expect(body.xpEarned).toBe(12) // QUIZ_PASS only — QUIZ_TRY was paid on the first attempt
  })

  it("awards only the perfect bonus when a perfect score follows a pass", async () => {
    await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 80 }))
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 100 }))
    const body = await res.json()
    expect(body.xpEarned).toBe(25) // QUIZ_PERFECT only
  })

  it("does not unlock 'quiz-master' by passing the same quiz five times", async () => {
    for (let i = 0; i < 5; i++) {
      await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 80 }))
    }
    const achievement = await prisma.achievement.findFirst({ where: { userId: ID, slug: "quiz-master" } })
    expect(achievement).toBeNull()
  })

  // --- Response shape ---

  it("returns expected response fields on a successful submission", async () => {
    const res = await POST(makePost("/api/progress/quiz", { blockId: BLOCK, score: 75 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("xpEarned")
    expect(body).toHaveProperty("passed")
    expect(body).toHaveProperty("perfect")
    expect(body).toHaveProperty("leveledUp")
    expect(body).toHaveProperty("newLevel")
    expect(body).toHaveProperty("newXP")
    expect(body).toHaveProperty("attempt")
    expect(body).toHaveProperty("achievements")
    expect(Array.isArray(body.achievements)).toBe(true)
  })
})
