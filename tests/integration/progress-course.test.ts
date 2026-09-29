import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { POST } from "@/app/api/progress/course/route"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { makePost } from "../helpers/make-request"
import { createTestUser, resetTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-course"

describe("POST /api/progress/course", () => {
  beforeAll(async () => { await createTestUser(ID) })
  beforeEach(async () => { setTestUserId(ID); await resetTestUser(ID) })
  afterAll(async () => { await deleteTestUser(ID) })

  it("returns 401 when unauthenticated", async () => {
    setTestUserId(null)
    const res = await POST(makePost("/api/progress/course", { action: "create", title: "T", platform: "P" }))
    expect(res.status).toBe(401)
  })

  describe("action: create", () => {
    it("creates a course record and awards ADD_COURSE XP (10)", async () => {
      const res = await POST(makePost("/api/progress/course", {
        action: "create", title: "TypeScript Deep Dive", platform: "Udemy", totalLessons: 50,
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.course.title).toBe("TypeScript Deep Dive")

      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(10) // ADD_COURSE
    })

    it("returns 400 when title is missing", async () => {
      const res = await POST(makePost("/api/progress/course", { action: "create", platform: "Udemy" }))
      expect(res.status).toBe(400)
    })

    it("returns 400 for a negative or non-integer totalLessons", async () => {
      for (const totalLessons of [-5, 2.5, "ten"]) {
        const res = await POST(makePost("/api/progress/course", {
          action: "create", title: "T", platform: "P", totalLessons,
        }))
        expect(res.status).toBe(400)
      }
    })
  })

  describe("action: update", () => {
    async function createCourse(totalLessons = 10) {
      return prisma.externalCourse.create({
        data: { userId: ID, title: "Test Course", platform: "Test", totalLessons },
      })
    }

    it("updates completedLessons", async () => {
      const course = await createCourse()
      const res = await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 5 }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.course.completedLessons).toBe(5)
      expect(body.course.isCompleted).toBe(false)
    })

    it("marks course complete and awards COMPLETE_COURSE XP (50) when completedLessons >= totalLessons", async () => {
      const course = await createCourse(10)
      const res = await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 10 }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.course.isCompleted).toBe(true)

      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(50) // COMPLETE_COURSE
    })

    it("does NOT re-award completion XP if already completed", async () => {
      const course = await createCourse(10)
      await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 10 }))
      await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 10 }))
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(50) // Not 100
    })

    it("does NOT re-award completion XP after un-completing and re-completing", async () => {
      const course = await createCourse(10)
      await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 10 }))
      await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 3 }))
      await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 10 }))
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(50) // Not 100
    })

    it("returns 404 when course id does not exist", async () => {
      const res = await POST(makePost("/api/progress/course", { action: "update", id: "nonexistent-id", completedLessons: 5 }))
      expect(res.status).toBe(404)
    })
  })

  describe("action: delete", () => {
    it("deletes a course owned by the user", async () => {
      const course = await prisma.externalCourse.create({
        data: { userId: ID, title: "Delete Me", platform: "Test" },
      })
      const res = await POST(makePost("/api/progress/course", { action: "delete", id: course.id }))
      expect(res.status).toBe(200)
      const deleted = await prisma.externalCourse.findUnique({ where: { id: course.id } })
      expect(deleted).toBeNull()
    })

    it("revokes the XP the course earned when it is deleted", async () => {
      const created = await POST(makePost("/api/progress/course", {
        action: "create", title: "Farm Me", platform: "Test", totalLessons: 1,
      }))
      const { course } = await created.json()
      await POST(makePost("/api/progress/course", { action: "update", id: course.id, completedLessons: 1 }))
      const before = await prisma.user.findUnique({ where: { id: ID } })
      expect(before!.totalXP).toBeGreaterThanOrEqual(60) // 10 (add) + 50 (complete) + any achievements

      const res = await POST(makePost("/api/progress/course", { action: "delete", id: course.id }))
      expect(res.status).toBe(200)
      const after = await prisma.user.findUnique({ where: { id: ID } })
      expect(after!.totalXP).toBe(before!.totalXP - 60)
    })

    it("never drops totalXP below zero when revoking", async () => {
      const course = await prisma.externalCourse.create({
        data: { userId: ID, title: "Imported", platform: "Test", xpEarned: 500 },
      })
      await prisma.user.update({ where: { id: ID }, data: { totalXP: 100, level: 1 } })
      await POST(makePost("/api/progress/course", { action: "delete", id: course.id }))
      const user = await prisma.user.findUnique({ where: { id: ID } })
      expect(user!.totalXP).toBe(0)
      expect(user!.level).toBe(1)
    })

    it("returns 400 when the course id is missing", async () => {
      const res = await POST(makePost("/api/progress/course", { action: "delete" }))
      expect(res.status).toBe(400)
    })

    it("returns 404 when trying to delete a non-existent course", async () => {
      const res = await POST(makePost("/api/progress/course", { action: "delete", id: "bad-id" }))
      expect(res.status).toBe(404)
    })
  })
})
