import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { prisma } from "@/lib/prisma"
import { awardXP, revokeXP, awardDailyLoginXP, updateStreak, checkAchievements } from "@/lib/user"
import { createTestUser, resetTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-helpers"

describe("lib/user.ts helpers", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => { await resetTestUser(ID) })
  afterAll(async () => { await deleteTestUser(ID) })

  // ─── awardXP ───────────────────────────────────────────────────────────────

  describe("awardXP", () => {
    it("adds XP to totalXP in DB", async () => {
      const result = await awardXP(ID, 50)
      expect(result.newXP).toBe(50)
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(50)
    })

    it("returns leveledUp:false when below threshold", async () => {
      const result = await awardXP(ID, 50)
      expect(result.leveledUp).toBe(false)
      expect(result.newLevel).toBe(1)
    })

    it("returns leveledUp:true when crossing threshold (150 XP → level 2)", async () => {
      const result = await awardXP(ID, 150)
      expect(result.leveledUp).toBe(true)
      expect(result.newLevel).toBe(2)
    })

    it("upserts a dailyLog entry for today", async () => {
      await awardXP(ID, 10)
      const today = new Date()
      const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const log = await prisma.dailyLog.findUnique({
        where: { userId_date: { userId: ID, date: dateOnly } },
      })
      expect(log).not.toBeNull()
      expect(log!.xpEarned).toBe(10)
    })

    it("increments dailyLog xpEarned on second call same day", async () => {
      await awardXP(ID, 10)
      await awardXP(ID, 5)
      const today = new Date()
      const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const log = await prisma.dailyLog.findUnique({
        where: { userId_date: { userId: ID, date: dateOnly } },
      })
      expect(log!.xpEarned).toBe(15)
    })

    it("works inside prisma.$transaction", async () => {
      const result = await prisma.$transaction(async (tx) => {
        return awardXP(ID, 25, { db: tx })
      })
      expect(result.newXP).toBe(25)
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(25)
    })

    it("does not lose XP under concurrent awards", async () => {
      await Promise.all(Array.from({ length: 10 }, () => awardXP(ID, 20)))
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(200)
      expect(user!.level).toBe(2)
    })
  })

  // ─── revokeXP ──────────────────────────────────────────────────────────────

  describe("revokeXP", () => {
    it("subtracts XP and recalculates level", async () => {
      await awardXP(ID, 200) // level 2
      const result = await revokeXP(ID, 100)
      expect(result).toEqual({ newXP: 100, newLevel: 1 })
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(100)
      expect(user!.level).toBe(1)
    })

    it("clamps at zero", async () => {
      await awardXP(ID, 30)
      const result = await revokeXP(ID, 100)
      expect(result.newXP).toBe(0)
    })
  })

  // ─── awardDailyLoginXP ─────────────────────────────────────────────────────

  describe("awardDailyLoginXP", () => {
    it("awards DAILY_LOGIN XP (5) on first call today", async () => {
      await awardDailyLoginXP(ID)
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(5)
    })

    it("is idempotent — does not double-award on sequential same-day calls", async () => {
      await awardDailyLoginXP(ID)
      await awardDailyLoginXP(ID)
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(5) // 5, not 10
    })
  })

  // ─── updateStreak ──────────────────────────────────────────────────────────

  describe("updateStreak", () => {
    it("starts streak at 1 when lastSeenAt is null", async () => {
      const newStreak = await updateStreak(ID)
      expect(newStreak).toBe(1)
    })

    it("increments streak on consecutive day", async () => {
      const yesterday = new Date(Date.now() - 86_400_000)
      await prisma.user.update({ where: { id: ID }, data: { lastSeenAt: yesterday, streak: 1 } })
      const newStreak = await updateStreak(ID)
      expect(newStreak).toBe(2)
    })

    it("resets streak to 1 when there is a gap", async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
      await prisma.user.update({ where: { id: ID }, data: { lastSeenAt: threeDaysAgo, streak: 5 } })
      const newStreak = await updateStreak(ID)
      expect(newStreak).toBe(1)
    })

    it("returns unchanged streak when already called today", async () => {
      await updateStreak(ID) // first call → streak = 1
      const secondCallResult = await updateStreak(ID) // second call same day → no change
      expect(secondCallResult).toBe(1)
    })

    it("awards 7-day streak bonus once and creates achievement record", async () => {
      const yesterday = new Date(Date.now() - 86_400_000)
      await prisma.user.update({ where: { id: ID }, data: { lastSeenAt: yesterday, streak: 6 } })
      await updateStreak(ID)
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.streak).toBe(7)
      expect(user!.totalXP).toBe(10) // STREAK_BONUS_7
      const ach = await prisma.achievement.findFirst({ where: { userId: ID, slug: "streak_bonus_7" } })
      expect(ach).not.toBeNull()
    })

    it("does NOT re-award 7-day bonus after breaking and rebuilding streak", async () => {
      // Earn the bonus the first time
      const yesterday = new Date(Date.now() - 86_400_000)
      await prisma.user.update({ where: { id: ID }, data: { lastSeenAt: yesterday, streak: 6 } })
      await updateStreak(ID) // streak reaches 7, bonus awarded
      // Reset streak and rebuild to 7
      await prisma.user.update({ where: { id: ID }, data: { lastSeenAt: yesterday, streak: 6 } })
      await updateStreak(ID) // streak reaches 7 again
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(10) // Still 10, not 20
    })
  })

  // ─── checkAchievements ─────────────────────────────────────────────────────

  describe("checkAchievements", () => {
    it("unlocks first_block and awards its XP bonus", async () => {
      await prisma.blockProgress.create({
        data: { userId: ID, blockId: "m1w1-b1", month: 1, week: 1, status: "COMPLETED", xpEarned: 15 },
      })
      const unlocked = await checkAchievements(ID)
      expect(unlocked.map((a) => a.slug)).toContain("first_block")
      const user = await prisma.user.findUnique({ where: { id: ID } })
      // first_block xpBonus = 10 (from ACHIEVEMENT_DEFINITIONS in lib/xp.ts)
      expect(user!.totalXP).toBe(10)
    })

    it("returns empty array when no new achievements", async () => {
      const unlocked = await checkAchievements(ID)
      expect(unlocked).toHaveLength(0)
    })

    it("does not create duplicate achievement on repeated call", async () => {
      await prisma.blockProgress.create({
        data: { userId: ID, blockId: "m1w1-b1", month: 1, week: 1, status: "COMPLETED", xpEarned: 15 },
      })
      await checkAchievements(ID)
      await checkAchievements(ID)
      const records = await prisma.achievement.findMany({ where: { userId: ID, slug: "first_block" } })
      expect(records).toHaveLength(1)
    })

    it("awards an achievement's XP bonus once under concurrent calls", async () => {
      await prisma.blockProgress.create({
        data: { userId: ID, blockId: "m1w1-b1", month: 1, week: 1, status: "COMPLETED", xpEarned: 10 },
      })
      const results = await Promise.all([checkAchievements(ID), checkAchievements(ID), checkAchievements(ID)])
      expect(results.flat().filter((a) => a.slug === "first_block")).toHaveLength(1)
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(10) // first_block bonus, once
    })
  })
})
