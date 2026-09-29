import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, awardXP, revokeXP, lockUser, checkAchievements } from "@/lib/user"
import { isDemoUser } from "@/lib/demo"
import { XP_VALUES } from "@/lib/xp"

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ error: "Demo mode is read-only" }, { status: 403 })
  }

  const body = await req.json()
  const { action, ...data } = body

  if (action === "create") {
    const { title, platform, url, totalLessons } = data
    if (typeof title !== "string" || title.length === 0 || title.length > 200) {
      return NextResponse.json({ error: "Title must be 1–200 characters" }, { status: 400 })
    }
    if (typeof platform !== "string" || platform.length === 0 || platform.length > 100) {
      return NextResponse.json({ error: "Platform must be 1–100 characters" }, { status: 400 })
    }
    if (url !== undefined && url !== null) {
      try {
        const u = new URL(url)
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
      }
    }

    const course = await prisma.$transaction(async (tx) => {
      const created = await tx.externalCourse.create({
        data: {
          userId: user.id,
          title,
          platform,
          url: url || null,
          totalLessons: Number(totalLessons) || 0,
          xpEarned: XP_VALUES.ADD_COURSE,
        },
      })
      await awardXP(user.id, XP_VALUES.ADD_COURSE, { db: tx })
      return created
    })

    return NextResponse.json({ success: true, course })
  }

  if (action === "update") {
    const { id, completedLessons } = data
    if (!id) return NextResponse.json({ error: "Missing course id" }, { status: 400 })
    if (typeof completedLessons !== "number" || !Number.isInteger(completedLessons) || completedLessons < 0) {
      return NextResponse.json({ error: "completedLessons must be a non-negative integer" }, { status: 400 })
    }

    const { updated, justCompleted } = await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id)

      const course = await tx.externalCourse.findUnique({ where: { id } })
      if (!course || course.userId !== user.id) return { updated: null, justCompleted: false }

      const isNowCompleted = course.totalLessons > 0 && completedLessons >= course.totalLessons
      // completedAt survives un-completing, so completion XP is paid exactly once
      const wasCompleted = course.isCompleted || course.completedAt !== null

      const updated = await tx.externalCourse.update({
        where: { id },
        data: {
          completedLessons,
          isCompleted: isNowCompleted,
          completedAt: isNowCompleted && !wasCompleted ? new Date() : course.completedAt,
        },
      })

      if (isNowCompleted && !wasCompleted) {
        await awardXP(user.id, XP_VALUES.COMPLETE_COURSE, { db: tx })
        await tx.externalCourse.update({
          where: { id },
          data: { xpEarned: { increment: XP_VALUES.COMPLETE_COURSE } },
        })
      }

      return { updated, justCompleted: isNowCompleted && !wasCompleted }
    })

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (justCompleted) await checkAchievements(user.id)

    return NextResponse.json({ success: true, course: updated })
  }

  if (action === "delete") {
    const { id } = data
    const deleted = await prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id)

      const course = await tx.externalCourse.findUnique({ where: { id } })
      if (!course || course.userId !== user.id) return false

      // Take back the XP this course earned, otherwise add → delete → add farms XP
      if (course.xpEarned > 0) {
        await revokeXP(user.id, course.xpEarned, { db: tx })
      }
      await tx.externalCourse.delete({ where: { id } })
      return true
    })
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
