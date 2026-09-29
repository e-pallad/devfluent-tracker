import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, awardXP, lockUser, checkAchievements } from "@/lib/user"
import { isDemoUser } from "@/lib/demo"
import { XP_VALUES } from "@/lib/xp"
import { getTrackById, CURRICULUM } from "@/content/curriculum"

// Reject javascript: and other non-http(s) URL schemes
function isSafeUrl(value: unknown): boolean {
  if (!value || typeof value !== "string") return true
  try {
    const u = new URL(value)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ error: "Demo mode is read-only" }, { status: 403 })
  }

  const body = await req.json()
  const { action, month, repoUrl, liveUrl } = body

  if (!month || typeof month !== "number") {
    return NextResponse.json({ error: "Missing month" }, { status: 400 })
  }

  if (!isSafeUrl(repoUrl) || !isSafeUrl(liveUrl)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  const months = getTrackById(user.track)?.months ?? CURRICULUM
  const monthData = months.find((m) => m.month === month)
  if (!monthData) return NextResponse.json({ error: "Month not found" }, { status: 404 })

  const track = user.track

  if (action === "start") {
    const existing = await prisma.monthlyProject.findUnique({
      where: { userId_track_month: { userId: user.id, track, month } },
    })
    // Starting again must not reopen a finished project
    if (existing?.status === "COMPLETED") {
      return NextResponse.json({ success: true, project: existing })
    }

    const project = await prisma.monthlyProject.upsert({
      where: { userId_track_month: { userId: user.id, track, month } },
      create: {
        userId: user.id,
        track,
        month,
        title: monthData.projectTitle,
        description: monthData.projectDescription,
        status: "IN_PROGRESS",
      },
      update: {
        status: "IN_PROGRESS",
      },
    })
    return NextResponse.json({ success: true, project })
  }

  if (action === "complete") {
    const { project, leveledUp, newLevel, justCompleted } = await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id)

      const existing = await tx.monthlyProject.findUnique({
        where: { userId_track_month: { userId: user.id, track, month } },
      })
      // completedAt is kept once set, so completion XP is paid exactly once
      const wasCompleted = Boolean(existing?.completedAt)

      const project = await tx.monthlyProject.upsert({
        where: { userId_track_month: { userId: user.id, track, month } },
        create: {
          userId: user.id,
          track,
          month,
          title: monthData.projectTitle,
          description: monthData.projectDescription,
          status: "COMPLETED",
          repoUrl: repoUrl || null,
          liveUrl: liveUrl || null,
          completedAt: new Date(),
          xpEarned: XP_VALUES.COMPLETE_PROJECT,
        },
        update: {
          status: "COMPLETED",
          repoUrl: repoUrl || null,
          liveUrl: liveUrl || null,
          ...(!wasCompleted ? { completedAt: new Date(), xpEarned: XP_VALUES.COMPLETE_PROJECT } : {}),
        },
      })

      let leveledUp = false
      let newLevel = user.level

      if (!wasCompleted) {
        const result = await awardXP(user.id, XP_VALUES.COMPLETE_PROJECT, { db: tx })
        leveledUp = result.leveledUp
        newLevel = result.newLevel
      }

      return { project, leveledUp, newLevel, justCompleted: !wasCompleted }
    })

    if (justCompleted) await checkAchievements(user.id)

    return NextResponse.json({ success: true, project, leveledUp, newLevel })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
