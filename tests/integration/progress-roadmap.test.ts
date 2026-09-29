import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import type { RoadmapSection } from "@/lib/roadmap"
import { POST } from "@/app/api/progress/roadmap/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { makePost } from "../helpers/make-request"
import { createTestUser, resetTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-roadmap"
const ROADMAP = "frontend"
const NODE = "html-basics"
const TOPIC = "internet"

const SECTIONS: RoadmapSection[] = [
  {
    topic: { id: TOPIC, label: "Internet", type: "topic" },
    subtopics: [{ id: NODE, label: "HTML Basics", type: "subtopic" }],
  },
]

// Mutable so individual tests can simulate the roadmap source being unavailable
let mockSections: RoadmapSection[] = SECTIONS

// The real getRoadmapSections fetches from GitHub through Next's data cache;
// keep the rest of the module (AVAILABLE_ROADMAPS, getAllTrackableNodes) real.
vi.mock("@/lib/roadmap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/roadmap")>()
  return { ...actual, getRoadmapSections: vi.fn(async () => mockSections) }
})

describe("POST /api/progress/roadmap", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => {
    setTestUserId(ID)
    mockSections = SECTIONS
    await resetTestUser(ID)
  })
  afterAll(async () => { await deleteTestUser(ID) })

  it("returns 401 when unauthenticated", async () => {
    setTestUserId(null)
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: NODE, status: "COMPLETED",
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid status", async () => {
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: NODE, status: "INVALID",
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(makePost("/api/progress/roadmap", { roadmapId: ROADMAP }))
    expect(res.status).toBe(400)
  })

  it("completes a subtopic and awards ROADMAP_SUBTOPIC XP (5)", async () => {
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: NODE, nodeType: "subtopic", status: "COMPLETED",
    }))
    expect(res.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(5) // ROADMAP_SUBTOPIC
  })

  it("completes a topic and awards ROADMAP_TOPIC XP (10)", async () => {
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: TOPIC, nodeType: "topic", status: "COMPLETED",
    }))
    expect(res.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(10) // ROADMAP_TOPIC
  })

  it("does NOT re-award XP when completing an already-completed node", async () => {
    await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: TOPIC, status: "COMPLETED",
    }))
    await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: TOPIC, status: "COMPLETED",
    }))
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(10) // Not 20
  })

  it("does NOT re-award XP when cycling a node through all statuses", async () => {
    // The roadmap UI click-cycles NOT_STARTED → IN_PROGRESS → COMPLETED → SKIPPED → …
    for (const status of ["IN_PROGRESS", "COMPLETED", "SKIPPED", "NOT_STARTED", "IN_PROGRESS", "COMPLETED"]) {
      const res = await POST(makePost("/api/progress/roadmap", { roadmapId: ROADMAP, nodeId: TOPIC, status }))
      expect(res.status).toBe(200)
    }
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(10) // once, not 20
    const record = await prisma.roadmapProgress.findFirst({ where: { userId: ID, nodeId: TOPIC } })
    expect(record!.status).toBe("COMPLETED")
  })

  it("uses the roadmap source's node type, not the client's", async () => {
    // Client claims the subtopic is a topic to get 10 XP instead of 5
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: NODE, nodeType: "topic", status: "COMPLETED",
    }))
    expect(res.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(5) // subtopic XP, not topic XP
    const record = await prisma.roadmapProgress.findFirst({ where: { userId: ID, nodeId: NODE } })
    expect(record!.nodeType).toBe("subtopic")
    expect(record!.nodeLabel).toBe("HTML Basics")
  })

  it("returns 404 for a node that isn't in the roadmap", async () => {
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: "made-up-node", status: "COMPLETED",
    }))
    expect(res.status).toBe(404)
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(0)
  })

  it("returns 404 for an unknown roadmap", async () => {
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: "not-a-roadmap", nodeId: NODE, status: "COMPLETED",
    }))
    expect(res.status).toBe(404)
  })

  it("returns 503 when roadmap data can't be loaded", async () => {
    mockSections = []
    const res = await POST(makePost("/api/progress/roadmap", {
      roadmapId: ROADMAP, nodeId: NODE, status: "COMPLETED",
    }))
    expect(res.status).toBe(503)
  })
})
