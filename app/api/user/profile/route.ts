import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, INVALID_JSON } from "@/lib/http"
import { getCurrentUser } from "@/lib/user"
import { TRACKS } from "@/content/curriculum"

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await readJson(req)
  if (!body) return NextResponse.json(INVALID_JSON, { status: 400 })
  const { name, track, dailyGoalBlocks, weeklyGoalBlocks } = body

  if (name !== undefined && name !== null && (typeof name !== "string" || name.length > 100)) {
    return NextResponse.json({ error: "Name must be a string of 100 characters or fewer" }, { status: 400 })
  }

  const validTracks = TRACKS.map((t) => t.meta.id)
  if (track !== undefined && !validTracks.includes(track)) {
    return NextResponse.json({ error: "Invalid track" }, { status: 400 })
  }

  if (dailyGoalBlocks !== undefined && (!Number.isInteger(dailyGoalBlocks) || dailyGoalBlocks < 1 || dailyGoalBlocks > 20)) {
    return NextResponse.json({ error: "dailyGoalBlocks must be an integer 1–20" }, { status: 400 })
  }

  if (weeklyGoalBlocks !== undefined && (!Number.isInteger(weeklyGoalBlocks) || weeklyGoalBlocks < 1 || weeklyGoalBlocks > 100)) {
    return NextResponse.json({ error: "weeklyGoalBlocks must be an integer 1–100" }, { status: 400 })
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(name !== undefined ? { name: name ?? null } : {}),
      ...(track !== undefined ? { track } : {}),
      ...(dailyGoalBlocks !== undefined ? { dailyGoalBlocks } : {}),
      ...(weeklyGoalBlocks !== undefined ? { weeklyGoalBlocks } : {}),
    },
  })

  return NextResponse.json({
    success: true,
    name: updated.name,
    track: updated.track,
    dailyGoalBlocks: updated.dailyGoalBlocks,
    weeklyGoalBlocks: updated.weeklyGoalBlocks,
  })
}
