/**
 * Integration tests for POST /api/stripe/checkout
 *
 * Requires an authenticated user (getCurrentUser) and a mocked Stripe client.
 * Portal tests live in stripe-portal.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { setTestUserId } from "../setup"
import { createTestUser, deleteTestUser } from "../helpers/test-user"

const ID = "test-user-stripe-checkout"

const TEST_PRICE_MONTHLY = "price_checkout_monthly"
const TEST_PRICE_ANNUAL = "price_checkout_annual"
const TEST_PRICE_LIFETIME = "price_checkout_lifetime"

// Set env vars before any module import
process.env.STRIPE_PRICE_MONTHLY_ID = TEST_PRICE_MONTHLY
process.env.STRIPE_PRICE_ANNUAL_ID = TEST_PRICE_ANNUAL
process.env.STRIPE_PRICE_LIFETIME_ID = TEST_PRICE_LIFETIME
process.env.NEXT_PUBLIC_APP_URL = "https://test.devfluent"

// ─── Stripe mock ─────────────────────────────────────────────────────────────

const mockSessionCreate = vi.fn()

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: { sessions: { create: mockSessionCreate } },
    billingPortal: { sessions: { create: vi.fn() } },
  },
  stripeWebhookSecret: "whsec_test",
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCheckoutRequest(body: object) {
  return new NextRequest("http://localhost/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/stripe/checkout", () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    await createTestUser(ID)
    const mod = await import("@/app/api/stripe/checkout/route")
    POST = mod.POST
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    setTestUserId(ID)
    await prisma.subscription.deleteMany({ where: { userId: ID } })
    await prisma.user.update({ where: { id: ID }, data: { subscriptionTier: "FREE" } })
  })

  afterAll(async () => {
    await deleteTestUser(ID)
  })

  it("returns 401 when unauthenticated", async () => {
    setTestUserId(null)
    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_MONTHLY }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when priceId is missing", async () => {
    const res = await POST(makeCheckoutRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/priceId/i)
  })

  it("returns 400 for an unrecognised priceId", async () => {
    const res = await POST(makeCheckoutRequest({ priceId: "price_unknown_123" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid priceId/i)
  })

  it("returns 409 when user is already Pro", async () => {
    await prisma.subscription.create({
      data: {
        userId: ID,
        tier: "PRO",
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    })
    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_MONTHLY }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already subscribed/i)
  })

  it("returns 409 when user is Lifetime", async () => {
    await prisma.subscription.create({
      data: { userId: ID, tier: "LIFETIME", status: "ACTIVE" },
    })
    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_MONTHLY }))
    expect(res.status).toBe(409)
  })

  it("creates a subscription-mode session for monthly price and returns URL", async () => {
    mockSessionCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session_monthly" })

    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_MONTHLY }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe("https://checkout.stripe.com/session_monthly")

    expect(mockSessionCreate).toHaveBeenCalledOnce()
    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.mode).toBe("subscription")
    expect(call.line_items[0].price).toBe(TEST_PRICE_MONTHLY)
    expect(call.metadata.userId).toBe(ID)
    expect(call.success_url).toContain("/settings/upgrade/success")
    expect(call.cancel_url).toContain("/settings/upgrade")
  })

  it("creates a subscription-mode session for annual price", async () => {
    mockSessionCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session_annual" })

    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_ANNUAL }))
    expect(res.status).toBe(200)

    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.mode).toBe("subscription")
    expect(call.line_items[0].price).toBe(TEST_PRICE_ANNUAL)
  })

  it("creates a payment-mode session for lifetime price", async () => {
    mockSessionCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session_lifetime" })

    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_LIFETIME }))
    expect(res.status).toBe(200)

    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.mode).toBe("payment")
    expect(call.line_items[0].price).toBe(TEST_PRICE_LIFETIME)
    // Without this, payment-mode sessions have no customer and the webhook can't link them
    expect(call.customer_creation).toBe("always")
    expect(call.customer_email).toBe(`${ID}@test.devfluent`)
  })

  it("does not set customer_creation for subscription-mode sessions", async () => {
    mockSessionCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session_monthly" })

    await POST(makeCheckoutRequest({ priceId: TEST_PRICE_MONTHLY }))

    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.customer_creation).toBeUndefined()
  })

  it("reuses the existing Stripe customer of a lapsed subscription", async () => {
    await prisma.subscription.create({
      data: { userId: ID, tier: "PRO", status: "CANCELLED", stripeCustomerId: "cus_returning" },
    })
    mockSessionCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session_lifetime" })

    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_LIFETIME }))
    expect(res.status).toBe(200)

    const call = mockSessionCreate.mock.calls[0][0]
    expect(call.customer).toBe("cus_returning")
    expect(call.customer_email).toBeUndefined()
    expect(call.customer_creation).toBeUndefined()
  })

  it("returns 500 when Stripe session create throws", async () => {
    mockSessionCreate.mockRejectedValueOnce(new Error("Stripe API error"))

    const res = await POST(makeCheckoutRequest({ priceId: TEST_PRICE_MONTHLY }))
    expect(res.status).toBe(500)
  })

  it("returns 400 when request body is not valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
