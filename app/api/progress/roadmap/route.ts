import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readJson, INVALID_JSON } from "@/lib/http"
import { getCurrentUser, awardXP, lockUser } from "@/lib/user"
import { isDemoUser } from "@/lib/demo"
import { XP_VALUES } from "@/lib/xp"
import { AVAILABLE_ROADMAPS, getRoadmapSections, getAllTrackableNodes } from "@/lib/roadmap"

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ error: "Demo mode is read-only" }, { status: 403 })
  }

  const body = await readJson(req)
  if (!body) return NextResponse.json(INVALID_JSON, { status: 400 })
  const { roadmapId, nodeId, nodeLabel, nodeType, status } = body

  if (!roadmapId || !nodeId || !status) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  if (typeof roadmapId !== "string" || roadmapId.length > 100) {
    return NextResponse.json({ error: "Invalid roadmapId" }, { status: 400 })
  }
  if (typeof nodeId !== "string" || nodeId.length > 100) {
    return NextResponse.json({ error: "Invalid nodeId" }, { status: 400 })
  }
  if (nodeLabel !== undefined && (typeof nodeLabel !== "string" || nodeLabel.length > 200)) {
    return NextResponse.json({ error: "Invalid nodeLabel" }, { status: 400 })
  }

  const validStatuses = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED"]
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }, { status: 400 })
  }

  const validNodeTypes = ["topic", "subtopic", "step"]
  if (nodeType && !validNodeTypes.includes(nodeType)) {
    return NextResponse.json({ error: `Invalid nodeType. Must be one of: ${validNodeTypes.join(", ")}` }, { status: 400 })
  }

  if (!AVAILABLE_ROADMAPS.some((r) => r.id === roadmapId)) {
    return NextResponse.json({ error: "Roadmap not found" }, { status: 404 })
  }

  // Resolve the node from the roadmap source so XP can only be earned for real
  // nodes, and the node type (topic vs subtopic XP) can't be chosen by the client.
  const nodes = getAllTrackableNodes(await getRoadmapSections(roadmapId))
  if (nodes.length === 0) {
    return NextResponse.json({ error: "Roadmap data unavailable. Try again later." }, { status: 503 })
  }
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) {
    return NextResponse.json({ error: "Roadmap node not found" }, { status: 404 })
  }

  const { record } = await prisma.$transaction(async (tx) => {
    await lockUser(tx, user.id)

    const existing = await tx.roadmapProgress.findUnique({
      where: { userId_roadmapId_nodeId: { userId: user.id, roadmapId, nodeId } },
    })
    // completedAt marks the first completion and is never cleared, so cycling a
    // node's status (the UI click-cycles through all four) can't re-award XP.
    const firstCompletion = status === "COMPLETED" && !existing?.completedAt

    const record = await tx.roadmapProgress.upsert({
      where: { userId_roadmapId_nodeId: { userId: user.id, roadmapId, nodeId } },
      create: {
        userId: user.id,
        roadmapId,
        nodeId,
        nodeLabel: node.label,
        nodeType: node.type,
        status,
        completedAt: firstCompletion ? new Date() : null,
      },
      update: {
        status,
        nodeLabel: node.label,
        nodeType: node.type,
        ...(firstCompletion ? { completedAt: new Date() } : {}),
      },
    })

    if (firstCompletion) {
      const xp = node.type === "topic" ? XP_VALUES.ROADMAP_TOPIC : XP_VALUES.ROADMAP_SUBTOPIC
      await awardXP(user.id, xp, { db: tx })
    }

    return { record }
  })

  return NextResponse.json({ success: true, record })
}
