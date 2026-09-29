import { cache } from "react"
import { startOfDay, differenceInCalendarDays } from "date-fns"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { PrismaClient } from "@/app/generated/prisma/client"
import { getLevelFromXP, ACHIEVEMENT_DEFINITIONS, XP_VALUES, type AchievementRarity } from "@/lib/xp"
import { hasDemoSession, createDemoUser } from "@/lib/demo"

// Accepts either the full PrismaClient or a transaction client
type DbClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">

/**
 * Gets the current authenticated user's database record.
 * Creates it if it doesn't exist yet (first login).
 *
 * Wrapped in React `cache` so the layout and page of one request share a
 * single Supabase auth check and DB read (a no-op outside Server Components).
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) {
    if (await hasDemoSession()) {
      return createDemoUser()
    }
    return null
  }

  // Read first — the upsert below is a write and only needed on first login
  const existing = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (existing) return existing

  // upsert prevents unique constraint errors when concurrent requests race on first login
  const user = await prisma.user.upsert({
    where: { id: authUser.id },
    update: {},
    create: {
      id: authUser.id,
      email: authUser.email!,
      name: authUser.user_metadata?.name ?? null,
      avatarUrl: authUser.user_metadata?.avatar_url ?? null,
    },
  })

  return user
})

/**
 * Award the 5 XP daily login bonus — idempotent, at most once per calendar day.
 * Safe to call on every dashboard load.
 */
export async function awardDailyLoginXP(userId: string): Promise<void> {
  const today = new Date()
  const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // Atomic: skipDuplicates ensures at most one record per (userId, date)
  // count=1 means we just created it (first login today) → award XP
  // count=0 means it already existed → skip
  const { count } = await prisma.dailyLog.createMany({
    data: [{ userId, date: dateOnly, xpEarned: 0 }],
    skipDuplicates: true,
  })
  if (count > 0) {
    await awardXP(userId, XP_VALUES.DAILY_LOGIN)
  }
}

/**
 * Lock the user's row until the surrounding transaction ends.
 *
 * Call this first in every transaction that checks state and then awards XP:
 * under READ COMMITTED two concurrent requests would otherwise both pass the
 * "not yet awarded" check and both pay out.
 */
export async function lockUser(db: DbClient, userId: string): Promise<void> {
  await db.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
}

/**
 * Award XP to a user and recalculate level.
 * Returns the updated user and whether they leveled up.
 */
export async function awardXP(
  userId: string,
  amount: number,
  context: { date?: Date; db?: DbClient } = {}
): Promise<{ leveledUp: boolean; newLevel: number; newXP: number }> {
  const db = context.db ?? prisma

  // Atomic increment — a read-then-write would lose concurrent awards
  const updated = await db.user.update({
    where: { id: userId },
    data: { totalXP: { increment: amount } },
    select: { totalXP: true, level: true },
  })

  const newXP = updated.totalXP
  const newLevel = getLevelFromXP(newXP)
  const leveledUp = newLevel > updated.level

  if (newLevel !== updated.level) {
    await db.user.update({ where: { id: userId }, data: { level: newLevel } })
  }

  // Update or create today's daily log
  const today = context.date ?? new Date()
  const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  await db.dailyLog.upsert({
    where: { userId_date: { userId, date: dateOnly } },
    create: { userId, date: dateOnly, xpEarned: amount },
    update: { xpEarned: { increment: amount } },
  })

  return { leveledUp, newLevel, newXP }
}

/**
 * Take back XP that was granted for something the user has since removed
 * (e.g. a deleted course). Never drops below 0; recalculates level.
 * Daily logs are left alone — they record what was earned that day.
 */
export async function revokeXP(
  userId: string,
  amount: number,
  context: { db?: DbClient } = {}
): Promise<{ newLevel: number; newXP: number }> {
  const db = context.db ?? prisma

  const updated = await db.user.update({
    where: { id: userId },
    data: { totalXP: { decrement: amount } },
    select: { totalXP: true, level: true },
  })

  const newXP = Math.max(0, updated.totalXP)
  const newLevel = getLevelFromXP(newXP)
  if (newXP !== updated.totalXP || newLevel !== updated.level) {
    await db.user.update({ where: { id: userId }, data: { totalXP: newXP, level: newLevel } })
  }

  return { newLevel, newXP }
}

/**
 * Update streak: call once per day on any meaningful action.
 * Returns new streak value.
 */
export async function updateStreak(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error("User not found")

  const today = startOfDay(new Date())
  const lastSeen = user.lastSeenAt ? startOfDay(new Date(user.lastSeenAt)) : null

  let newStreak = user.streak
  let usedFreeze = false

  if (!lastSeen) {
    newStreak = 1
  } else {
    const daysDiff = differenceInCalendarDays(today, lastSeen)
    if (daysDiff === 0) {
      // Already logged today — no change
      return user.streak
    } else if (daysDiff === 1) {
      // Consecutive day
      newStreak = user.streak + 1
    } else if (daysDiff === 2) {
      // Missed exactly one day — auto-consume freeze if available this week
      const freezeAvailable = !user.streakFreezeUsedAt ||
        differenceInCalendarDays(today, startOfDay(new Date(user.streakFreezeUsedAt))) >= 7
      if (freezeAvailable) {
        usedFreeze = true
        newStreak = user.streak + 1
      } else {
        newStreak = 1
      }
    } else {
      // Gap > 1 day — reset
      newStreak = 1
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      streak: newStreak,
      lastSeenAt: new Date(),
      ...(usedFreeze ? { streakFreezeUsedAt: new Date() } : {}),
    },
  })

  // Streak bonuses — only award once per streak cycle (exact milestone, not re-award on re-reach)
  // Wrapped in a transaction so the achievement record and XP are always consistent.
  if (newStreak === 7) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.achievement.createMany({
        data: [{ userId, slug: "streak_bonus_7", label: "7-Day Streak Bonus", description: "Bonus XP for a 7-day streak", icon: "🔥", xpBonus: XP_VALUES.STREAK_BONUS_7 }],
        skipDuplicates: true,
      })
      if (count > 0) {
        await awardXP(userId, XP_VALUES.STREAK_BONUS_7, { db: tx })
      }
    })
  } else if (newStreak === 30) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.achievement.createMany({
        data: [{ userId, slug: "streak_bonus_30", label: "30-Day Streak Bonus", description: "Bonus XP for a 30-day streak", icon: "⚡", xpBonus: XP_VALUES.STREAK_BONUS_30 }],
        skipDuplicates: true,
      })
      if (count > 0) {
        await awardXP(userId, XP_VALUES.STREAK_BONUS_30, { db: tx })
      }
    })
  }

  return newStreak
}

export interface UnlockedAchievement {
  slug: string
  label: string
  description: string
  icon: string
  xpBonus: number
  rarity: AchievementRarity
}

/**
 * Check and unlock any newly earned achievements.
 */
export async function checkAchievements(userId: string): Promise<UnlockedAchievement[]> {
  const [user, existingAchievements, projects, blocks, quizAttempts, passedQuizBlocks, perfectQuizBlocks, githubPushes, githubPRsMerged, accountabilityCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.achievement.findMany({ where: { userId }, select: { slug: true } }),
    prisma.monthlyProject.count({ where: { userId, status: "COMPLETED" } }),
    prisma.blockProgress.count({ where: { userId, status: "COMPLETED" } }),
    prisma.quizAttempt.count({ where: { userId } }),
    // Distinct quizzes, not attempts — retaking one quiz must not unlock "pass 5 quizzes"
    prisma.quizAttempt.groupBy({ by: ["blockId"], where: { userId, passed: true } }),
    prisma.quizAttempt.groupBy({ by: ["blockId"], where: { userId, perfect: true } }),
    prisma.githubEvent.count({ where: { userId, eventType: "PushEvent" } }),
    prisma.githubEvent.count({ where: { userId, eventType: "PullRequestEvent", xpAwarded: { gte: XP_VALUES.GITHUB_PR_MERGED } } }),
    // Only confirmed (mutual) partnerships count
    prisma.accountabilityPair.count({
      where: { requesterId: userId, partner: { sentPairs: { some: { partnerId: userId } } } },
    }),
  ])

  if (!user) return []

  const existingSlugs = new Set(existingAchievements.map((a) => a.slug))
  const stats = {
    streak: user.streak,
    level: user.level,
    totalXP: user.totalXP,
    projectsCompleted: projects,
    blocksCompleted: blocks,
    quizAttempts,
    quizzesPassed: passedQuizBlocks.length,
    perfectQuizzes: perfectQuizBlocks.length,
    githubPushes,
    githubPRsMerged,
    accountabilityLinked: accountabilityCount > 0,
  }

  const toUnlock = ACHIEVEMENT_DEFINITIONS.filter(
    (def) => !existingSlugs.has(def.slug) && def.check(stats)
  )

  if (toUnlock.length === 0) return []

  // skipDuplicates prevents unique constraint errors from concurrent calls; only
  // the rows this call actually inserted pay out, so a concurrent call that
  // computed the same toUnlock list cannot award the bonus twice.
  const unlocked = await prisma.$transaction(async (tx) => {
    const created = await tx.achievement.createManyAndReturn({
      data: toUnlock.map((def) => ({
        userId,
        slug: def.slug,
        label: def.label,
        description: def.description,
        icon: def.icon,
        xpBonus: def.xpBonus,
      })),
      skipDuplicates: true,
      select: { slug: true },
    })
    const createdSlugs = new Set(created.map((a) => a.slug))
    const newlyUnlocked = toUnlock.filter((def) => createdSlugs.has(def.slug))

    const totalXPBonus = newlyUnlocked.reduce((sum, def) => sum + (def.xpBonus > 0 ? def.xpBonus : 0), 0)
    if (totalXPBonus > 0) {
      await awardXP(userId, totalXPBonus, { db: tx })
    }
    return newlyUnlocked
  })

  return unlocked.map((d) => ({
    slug: d.slug,
    label: d.label,
    description: d.description,
    icon: d.icon,
    xpBonus: d.xpBonus,
    rarity: d.rarity,
  }))
}
