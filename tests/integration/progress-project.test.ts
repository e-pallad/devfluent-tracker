import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { POST } from "@/app/api/progress/project/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { makePost } from "../helpers/make-request"
import { createTestUser, resetTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-project"

describe("POST /api/progress/project", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => { setTestUserId(ID); await resetTestUser(ID) })
  afterAll(async () => { await deleteTestUser(ID) })

  it("returns 401 when unauthenticated", async () => {
    setTestUserId(null)
    const res = await POST(makePost("/api/progress/project", { action: "start", month: 1 }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when month is missing", async () => {
    const res = await POST(makePost("/api/progress/project", { action: "start" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 for month not in curriculum", async () => {
    const res = await POST(makePost("/api/progress/project", { action: "start", month: 99 }))
    expect(res.status).toBe(404)
  })

  it("starts a project with IN_PROGRESS status", async () => {
    const res = await POST(makePost("/api/progress/project", { action: "start", month: 1 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.status).toBe("IN_PROGRESS")
  })

  it("completes a project and awards COMPLETE_PROJECT XP (100)", async () => {
    const res = await POST(makePost("/api/progress/project", { action: "complete", month: 1 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.project.status).toBe("COMPLETED")

    // totalXP = 100 (project) + 50 (first_project achievement bonus)
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(150)
  })

  it("does NOT re-award XP when completing an already-completed project", async () => {
    await POST(makePost("/api/progress/project", { action: "complete", month: 1 }))
    await POST(makePost("/api/progress/project", { action: "complete", month: 1 }))
    // After first completion: 100 (project) + 50 (first_project achievement) = 150
    // Second completion: no XP awarded, totalXP stays at 150
    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(150)
  })

  it("does NOT re-award XP for complete → start → complete", async () => {
    await POST(makePost("/api/progress/project", { action: "complete", month: 1 }))
    const start = await POST(makePost("/api/progress/project", { action: "start", month: 1 }))
    expect((await start.json()).project.status).toBe("COMPLETED") // not reopened
    await POST(makePost("/api/progress/project", { action: "complete", month: 1 }))

    const user = await prisma.user.findUnique({ where: { id: ID } })
    expect(user!.totalXP).toBe(150)
  })

  it("stores repoUrl and liveUrl on completion", async () => {
    const res = await POST(makePost("/api/progress/project", {
      action: "complete", month: 1,
      repoUrl: "https://github.com/user/repo",
      liveUrl: "https://project.example.com",
    }))
    const body = await res.json()
    expect(body.project.repoUrl).toBe("https://github.com/user/repo")
    expect(body.project.liveUrl).toBe("https://project.example.com")
  })
})
