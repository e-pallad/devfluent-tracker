import { prisma } from "@/lib/prisma"

export async function createTestUser(id: string) {
  return prisma.user.upsert({
    where: { id },
    create: { id, email: `${id}@test.devfluent`, name: "Test User" },
    update: {},
  })
}

export async function resetTestUser(id: string) {
  // Delete all related records first (some have FK constraints)
  await prisma.blockProgress.deleteMany({ where: { userId: id } })
  await prisma.dailyLog.deleteMany({ where: { userId: id } })
  await prisma.achievement.deleteMany({ where: { userId: id } })
  await prisma.roadmapProgress.deleteMany({ where: { userId: id } })
  await prisma.externalCourse.deleteMany({ where: { userId: id } })
  await prisma.monthlyProject.deleteMany({ where: { userId: id } })
  await prisma.subscription.deleteMany({ where: { userId: id } })
  await prisma.quizAttempt.deleteMany({ where: { userId: id } })
  await prisma.githubEvent.deleteMany({ where: { userId: id } })
  await prisma.aiRecommendation.deleteMany({ where: { userId: id } })
  await prisma.accountabilityPair.deleteMany({ where: { OR: [{ requesterId: id }, { partnerId: id }] } })
  // Reset mutable user fields to baseline
  await prisma.user.update({
    where: { id },
    data: { totalXP: 0, level: 1, streak: 0, lastSeenAt: null, subscriptionTier: "FREE" },
  })
}

export async function deleteTestUser(id: string) {
  // Cascade deletes all related records
  await prisma.user.delete({ where: { id } })
}
