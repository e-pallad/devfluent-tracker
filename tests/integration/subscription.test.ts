import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { prisma } from "@/lib/prisma"
import { getUserTier } from "@/lib/subscription"
import { createTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-subscription"

describe("lib/subscription.ts — getUserTier", () => {
  beforeAll(async () => { await createTestUser(ID) })

  beforeEach(async () => {
    // Clean up any Subscription rows between tests
    await prisma.subscription.deleteMany({ where: { userId: ID } })
    // Reset User.subscriptionTier to FREE
    await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "FREE" } })
  })

  afterAll(async () => { await deleteTestUser(ID) })

  it("returns FREE when no Subscription row and user tier is FREE", async () => {
    const tier = await getUserTier(ID)
    expect(tier).toBe("FREE")
  })

  it("returns PRO for an ACTIVE PRO subscription within period", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // 30 days from now
    await prisma.subscription.create({
      data: { userId: ID, tier: "PRO", status: "ACTIVE", currentPeriodEnd: future },
    })
    const tier = await getUserTier(ID)
    expect(tier).toBe("PRO")
  })

  it("returns PRO for a TRIALING subscription within period", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
    await prisma.subscription.create({
      data: { userId: ID, tier: "PRO", status: "TRIALING", currentPeriodEnd: future },
    })
    const tier = await getUserTier(ID)
    expect(tier).toBe("PRO")
  })

  it("returns LIFETIME for a LIFETIME subscription regardless of status/period", async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) // 30 days ago
    await prisma.subscription.create({
      data: { userId: ID, tier: "LIFETIME", status: "ACTIVE", currentPeriodEnd: past },
    })
    const tier = await getUserTier(ID)
    expect(tier).toBe("LIFETIME")
  })

  it("returns FREE for a CANCELLED PRO subscription", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    await prisma.subscription.create({
      data: { userId: ID, tier: "PRO", status: "CANCELLED", currentPeriodEnd: future },
    })
    const tier = await getUserTier(ID)
    expect(tier).toBe("FREE")
  })

  it("returns FREE for a PAST_DUE PRO subscription", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    await prisma.subscription.create({
      data: { userId: ID, tier: "PRO", status: "PAST_DUE", currentPeriodEnd: future },
    })
    const tier = await getUserTier(ID)
    expect(tier).toBe("FREE")
  })

  it("returns FREE for a PRO subscription with expired currentPeriodEnd", async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24) // yesterday
    await prisma.subscription.create({
      data: { userId: ID, tier: "PRO", status: "ACTIVE", currentPeriodEnd: past },
    })
    const tier = await getUserTier(ID)
    expect(tier).toBe("FREE")
  })

  it("returns PRO when no Subscription row but User.subscriptionTier is PRO (admin override)", async () => {
    await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "PRO" } })
    const tier = await getUserTier(ID)
    expect(tier).toBe("PRO")
  })

  it("returns FREE for a PAST_DUE subscription even if User.subscriptionTier says PRO", async () => {
    await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "PRO" } })
    await prisma.subscription.create({
      data: {
        userId: ID,
        tier: "PRO",
        status: "PAST_DUE",
        currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    })
    expect(await getUserTier(ID)).toBe("FREE")
  })

  it("Subscription row takes precedence over User.subscriptionTier field", async () => {
    // User field says PRO but the actual subscription row is expired
    await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "PRO" } })
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24)
    await prisma.subscription.create({
      data: { userId: ID, tier: "PRO", status: "ACTIVE", currentPeriodEnd: past },
    })
    // The Subscription row is authoritative — an expired row must not be
    // rescued by a stale User.subscriptionTier value
    const tier = await getUserTier(ID)
    expect(tier).toBe("FREE")
  })
})
