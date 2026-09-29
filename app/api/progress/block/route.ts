import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, awardXP, lockUser, updateStreak, checkAchievements } from "@/lib/user"
import { getBlock } from "@/content/curriculum"
import { XP_VALUES } from "@/lib/xp"
import { isDemoUser } from "@/lib/demo"

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ error: "Demo mode is read-only" }, { status: 403 })
  }

  const body = await req.json()
  const { blockId, status, minutesSpent, usedTimer } = body

  if (!blockId || !status) {
    return NextResponse.json({ error: "Missing required fields: blockId and status are required" }, { status: 400 })
  }

  const validStatuses = ["COMPLETED", "SKIPPED", "IN_PROGRESS"]
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }, { status: 400 })
  }

  const safeMinutes = typeof minutesSpent === "number" && minutesSpent >= 0 ? Math.floor(minutesSpent) : 0

  const block = getBlock(blockId)
  if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 })

  // Extract month/week — supports "m{month}w{week}-b{n}" and "{track}-m{month}w{week}-b{n}"
  const match = blockId.match(/m(\d+)w(\d+)-/)
  const month = match ? Number(match[1]) : 0
  const week = match ? Number(match[2]) : 0

  const isCompleting = status === "COMPLETED"
  const isSkipping = status === "SKIPPED"
  const completionXP = usedTimer ? XP_VALUES.COMPLETE_BLOCK_POMODORO : XP_VALUES.COMPLETE_BLOCK

  // Lock + check + upsert + XP award in one transaction so concurrent requests can't double-award
  const { record, firstCompletion, xpAwarded, leveledUp, newLevel, newXP } = await prisma.$transaction(async (tx) => {
    await lockUser(tx, user.id)

    const existing = await tx.blockProgress.findUnique({
      where: { userId_blockId: { userId: user.id, blockId } },
    })
    // completedAt is set on the first completion and never cleared, so it marks
    // "completion XP already paid" even if the block was later skipped/reopened.
    const firstCompletion = isCompleting && !existing?.completedAt
    // Skip XP is a one-time nudge for blocks that never earned anything
    const firstSkip = isSkipping && !existing?.completedAt && (existing?.xpEarned ?? 0) === 0
    const xpAwarded = firstCompletion ? completionXP : firstSkip ? XP_VALUES.SKIP_BLOCK : 0

    const record = await tx.blockProgress.upsert({
      where: { userId_blockId: { userId: user.id, blockId } },
      create: {
        userId: user.id,
        blockId,
        month,
        week,
        status,
        minutesSpent: safeMinutes,
        xpEarned: xpAwarded,
        completedAt: isCompleting ? new Date() : null,
      },
      update: {
        status,
        minutesSpent: { increment: safeMinutes },
        ...(firstCompletion ? { completedAt: new Date() } : {}),
        ...(xpAwarded > 0 ? { xpEarned: { increment: xpAwarded } } : {}),
      },
    })

    let leveledUp = false
    let newLevel = user.level
    let newXP = user.totalXP

    if (xpAwarded > 0) {
      const result = await awardXP(user.id, xpAwarded, { db: tx })
      leveledUp = result.leveledUp
      newLevel = result.newLevel
      newXP = result.newXP
    }

    // Increment blocksCompleted in DailyLog for today — first completion only, so
    // toggling a block can't inflate the daily/weekly goal bars
    if (firstCompletion) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      await tx.dailyLog.upsert({
        where: { userId_date: { userId: user.id, date: today } },
        create: { userId: user.id, date: today, blocksCompleted: 1 },
        update: { blocksCompleted: { increment: 1 } },
      })
    }

    return { record, firstCompletion, xpAwarded, leveledUp, newLevel, newXP }
  })

  let newAchievements: Awaited<ReturnType<typeof checkAchievements>> = []
  if (firstCompletion) {
    await updateStreak(user.id)
    newAchievements = await checkAchievements(user.id)
  }

  return NextResponse.json({ success: true, record, leveledUp, newLevel, newXP, xpAwarded, achievements: newAchievements })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ error: "Demo mode is read-only" }, { status: 403 })
  }

  const body = await req.json()
  const { blockId, notes } = body

  if (!blockId || typeof notes !== "string") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const safeNotes = notes.slice(0, 5000)

  // Extract month/week from blockId
  const match = blockId.match(/m(\d+)w(\d+)-/)
  const month = match ? Number(match[1]) : 0
  const week = match ? Number(match[2]) : 0

  await prisma.blockProgress.upsert({
    where: { userId_blockId: { userId: user.id, blockId } },
    create: { userId: user.id, blockId, month, week, notes: safeNotes },
    update: { notes: safeNotes },
  })

  return NextResponse.json({ success: true })
}
