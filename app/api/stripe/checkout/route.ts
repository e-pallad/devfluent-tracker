/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout session for a given price plan and returns the
 * session URL so the client can redirect the user there.
 *
 * Body: { priceId: string }
 *   priceId must be one of STRIPE_PRICE_MONTHLY_ID, STRIPE_PRICE_ANNUAL_ID,
 *   or STRIPE_PRICE_LIFETIME_ID (when set).
 *
 * Returns: { url: string }
 *
 * Security:
 *   - Requires authenticated session (getCurrentUser → 401 guard)
 *   - priceId is validated against the configured env-var price IDs — no
 *     arbitrary price IDs accepted, preventing users from creating sessions
 *     for unpublished or lower-priced plans.
 *   - metadata.userId is set on the session so the webhook can resolve the
 *     user without a separate customer lookup.
 *
 * Stripe notes:
 *   - mode: "subscription" for monthly/annual, "payment" for lifetime
 *   - payment mode sets customer_creation: "always" (Stripe otherwise leaves
 *     session.customer null and the webhook cannot link the purchase)
 *   - an existing stripeCustomerId is reused instead of creating a new customer
 *   - allow_promotion_codes: true — enables Stripe-hosted coupon input
 *   - success_url includes ?session_id={CHECKOUT_SESSION_ID} so we can
 *     display a thank-you message; actual activation is handled by the webhook.
 */

import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { getCurrentUser } from "@/lib/user"
import { getUserTier } from "@/lib/subscription"
import { prisma } from "@/lib/prisma"

// Resolve which price IDs are valid for this environment.
function validPriceIds(): { id: string; mode: "subscription" | "payment" }[] {
  const prices: { id: string; mode: "subscription" | "payment" }[] = []
  if (process.env.STRIPE_PRICE_MONTHLY_ID)
    prices.push({ id: process.env.STRIPE_PRICE_MONTHLY_ID, mode: "subscription" })
  if (process.env.STRIPE_PRICE_ANNUAL_ID)
    prices.push({ id: process.env.STRIPE_PRICE_ANNUAL_ID, mode: "subscription" })
  if (process.env.STRIPE_PRICE_LIFETIME_ID)
    prices.push({ id: process.env.STRIPE_PRICE_LIFETIME_ID, mode: "payment" })
  return prices
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  // Parse body
  let priceId: string
  try {
    const body = await req.json()
    priceId = body?.priceId
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!priceId || typeof priceId !== "string") {
    return NextResponse.json({ error: "priceId is required" }, { status: 400 })
  }

  // Validate priceId against configured prices
  const prices = validPriceIds()
  const matched = prices.find((p) => p.id === priceId)
  if (!matched) {
    return NextResponse.json({ error: "Invalid priceId" }, { status: 400 })
  }

  // Don't re-checkout if already Pro/Lifetime
  const tier = await getUserTier(user.id)
  if (tier === "PRO" || tier === "LIFETIME") {
    return NextResponse.json({ error: "Already subscribed" }, { status: 409 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  // Reuse the Stripe customer from a previous (e.g. cancelled) subscription so
  // returning users don't accumulate duplicate customers.
  const existingSub = await prisma.subscription.findUnique({
    where: { userId: user.id },
    select: { stripeCustomerId: true },
  })
  const customerParams = existingSub?.stripeCustomerId
    ? { customer: existingSub.stripeCustomerId }
    : {
        customer_email: user.email ?? undefined,
        // Payment-mode sessions don't create a Customer unless asked to; the
        // webhook and Customer Portal both need one for lifetime purchases.
        ...(matched.mode === "payment" ? { customer_creation: "always" as const } : {}),
      }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: matched.mode,
      line_items: [{ price: priceId, quantity: 1 }],
      // Embed userId so the webhook can resolve the user without a customer lookup
      metadata: { userId: user.id },
      ...customerParams,
      allow_promotion_codes: true,
      success_url: `${appUrl}/settings/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/settings/upgrade`,
      // For subscriptions, use the invoice to collect payment method on first cycle
      ...(matched.mode === "subscription"
        ? { subscription_data: { metadata: { userId: user.id } } }
        : {}),
    })

    if (!session.url) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
    }

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("[stripe/checkout] Error creating session:", err)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
