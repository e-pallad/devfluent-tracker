import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, awardXP, lockUser, checkAchievements } from "@/lib/user"
import { isDemoUser } from "@/lib/demo"
import { XP_VALUES } from "@/lib/xp"
import { getBlock } from "@/content/curriculum"

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ error: "Demo mode is read-only" }, { status: 403 })
  }

  const body = await req.json()
  const { blockId, score, answers } = body

  if (!blockId || typeof blockId !== "string") {
    return NextResponse.json({ error: "blockId must be a non-empty string" }, { status: 400 })
  }

  const block = getBlock(blockId)
  if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 })

  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
    return NextResponse.json({ error: "score must be an integer between 0 and 100" }, { status: 400 })
  }

  // answers is optional metadata — accept any record or undefined
  const safeAnswers = answers !== undefined ? answers : {}
  void safeAnswers // stored for future use; not persisted in this model yet

  const passed = score >= 70
  const perfect = score === 100

  // XP stacks, but each part pays out once per quiz: try XP on the first attempt,
  // the pass bonus on the first pass, the perfect bonus on the first perfect score.
  // Retakes are still recorded (stats, achievements) but earn nothing.
  const { attempt, xpEarned, leveledUp, newLevel, newXP } = await prisma.$transaction(async (tx) => {
    await lockUser(tx, user.id)

    const previous = await tx.quizAttempt.findMany({
      where: { userId: user.id, blockId },
      select: { passed: true, perfect: true },
    })
    let xpEarned = 0
    if (previous.length === 0) xpEarned += XP_VALUES.QUIZ_TRY
    if (passed && !previous.some((a) => a.passed)) xpEarned += XP_VALUES.QUIZ_PASS
    if (perfect && !previous.some((a) => a.perfect)) xpEarned += XP_VALUES.QUIZ_PERFECT

    const attempt = await tx.quizAttempt.create({
      data: {
        userId: user.id,
        blockId,
        score,
        passed,
        perfect,
        xpEarned,
      },
    })

    if (xpEarned === 0) {
      return { attempt, xpEarned, leveledUp: false, newLevel: user.level, newXP: user.totalXP }
    }
    const result = await awardXP(user.id, xpEarned, { db: tx })
    return { attempt, xpEarned, leveledUp: result.leveledUp, newLevel: result.newLevel, newXP: result.newXP }
  })

  const unlockedAchievements = await checkAchievements(user.id)

  return NextResponse.json({
    xpEarned,
    passed,
    perfect,
    leveledUp,
    newLevel,
    newXP,
    attempt,
    achievements: unlockedAchievements,
  })
}
