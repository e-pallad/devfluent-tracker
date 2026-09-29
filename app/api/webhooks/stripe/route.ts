/**
 * POST /api/webhooks/stripe
 *
 * Receives Stripe webhook events and keeps the `subscriptions` table in sync.
 *
 * Handled events:
 *   checkout.session.completed      → create/activate Subscription row (subscription + payment mode)
 *   customer.subscription.updated   → update tier/status/period fields
 *   customer.subscription.deleted   → mark CANCELLED, clear period
 *   invoice.payment_failed          → mark PAST_DUE
 *
 * User.subscriptionTier always mirrors the *effective* tier (FREE while a PRO
 * subscription is past due or cancelled). LIFETIME rows are never downgraded
 * by subscription events.
 *
 * All DB writes are wrapped in prisma.$transaction.
 * Stripe signature is verified before any processing.
 * Returns 200 immediately for unhandled event types (Stripe retries on non-2xx).
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *
 * The route is in PUBLIC_PATHS so auth middleware does not block it.
 * The Stripe signature provides its own authentication.
 */

import { NextRequest, NextResponse } from "next/server"
import type Stripe from "stripe"
import { stripe, stripeWebhookSecret } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"

// Map Stripe subscription statuses to our internal SubscriptionStatus enum.
// Stripe uses lowercase; our enum is uppercase.
function mapStripeStatus(
  stripeStatus: Stripe.Subscription["status"]
): "ACTIVE" | "CANCELLED" | "PAST_DUE" | "TRIALING" {
  switch (stripeStatus) {
    case "active":
      return "ACTIVE"
    case "trialing":
      return "TRIALING"
    case "past_due":
    case "unpaid":
      return "PAST_DUE"
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
    default:
      return "CANCELLED"
  }
}

// Derive SubscriptionTier from the Stripe price ID.
// STRIPE_PRICE_MONTHLY_ID and STRIPE_PRICE_ANNUAL_ID → PRO
// Any other price → FREE (safe fallback; avoids silently granting wrong tier)
function mapPriceTier(priceId: string): "PRO" | "LIFETIME" | "FREE" {
  const monthly = process.env.STRIPE_PRICE_MONTHLY_ID
  const annual = process.env.STRIPE_PRICE_ANNUAL_ID
  const lifetime = process.env.STRIPE_PRICE_LIFETIME_ID

  if (lifetime && priceId === lifetime) return "LIFETIME"
  if ((monthly && priceId === monthly) || (annual && priceId === annual)) return "PRO"
  return "FREE"
}

/**
 * Tier the user should actually have right now. LIFETIME never lapses; PRO only
 * counts while Stripe considers the subscription active. Mirrored onto
 * User.subscriptionTier so the fallback path never grants a lapsed plan.
 */
function effectiveTier(
  tier: "PRO" | "LIFETIME" | "FREE",
  status: "ACTIVE" | "CANCELLED" | "PAST_DUE" | "TRIALING"
): "PRO" | "LIFETIME" | "FREE" {
  if (tier === "LIFETIME") return "LIFETIME"
  if (tier === "PRO" && (status === "ACTIVE" || status === "TRIALING")) return "PRO"
  return "FREE"
}

/**
 * Current billing period end. Since API version 2025-03-31.basil the field lives
 * on subscription items rather than the subscription itself; the top-level
 * field is kept as a fallback for older payloads. Never returns an Invalid Date.
 */
function getPeriodEnd(sub: Stripe.Subscription): Date | null {
  const itemEnd = sub.items?.data?.[0]?.current_period_end
  const legacyEnd = (sub as unknown as { current_period_end?: number }).current_period_end
  const seconds = typeof itemEnd === "number" ? itemEnd : legacyEnd
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : null
}

/**
 * Resolve the userId from a Stripe customer ID.
 * We store stripeCustomerId on the Subscription row; look it up there first,
 * then fall back to the customer's metadata.userId if the row doesn't exist yet.
 */
async function resolveUserId(
  customerId: string,
  customerMetadata?: Record<string, string>
): Promise<string | null> {
  // Fast path: existing Subscription row already has the userId foreign key
  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  })
  if (existing) return existing.userId

  // Fallback: Stripe customer metadata set at checkout time
  if (customerMetadata?.userId) return customerMetadata.userId

  return null
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * checkout.session.completed
 *
 * Fired when a customer completes a Stripe Checkout session.
 * Handles both subscription mode (monthly/annual Pro) and payment mode (lifetime).
 * We expect `metadata.userId` to be set when creating the Checkout session.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" && session.mode !== "payment") return

  const userId =
    session.metadata?.userId ??
    (session.customer
      ? await resolveUserId(
          typeof session.customer === "string"
            ? session.customer
            : session.customer.id,
          session.metadata as Record<string, string>
        )
      : null)

  if (!userId) {
    console.error("[stripe/webhook] checkout.session.completed: no userId in metadata", {
      sessionId: session.id,
    })
    return
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id

  if (!stripe) return

  if (session.mode === "payment") {
    // Lifetime purchase — no subscription object. Retrieve line items to get the price ID.
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 })
    const priceId = lineItems.data[0]?.price?.id ?? ""
    const tier = mapPriceTier(priceId)

    if (tier !== "LIFETIME") {
      console.warn("[stripe/webhook] checkout.session.completed: payment mode but price is not LIFETIME", {
        sessionId: session.id,
        priceId,
      })
      return
    }

    await prisma.$transaction(async (tx) => {
      await tx.subscription.upsert({
        where: { userId },
        create: {
          userId,
          tier: "LIFETIME",
          status: "ACTIVE",
          // Null only for sessions created before customer_creation: "always"
          stripeCustomerId: customerId ?? null,
          // No stripeSubId for one-time payments
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
        update: {
          tier: "LIFETIME",
          status: "ACTIVE",
          ...(customerId ? { stripeCustomerId: customerId } : {}),
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
      })
      await tx.user.update({
        where: { id: userId },
        data: { subscriptionTier: "LIFETIME" },
      })
    })

    console.info("[stripe/webhook] checkout.session.completed: lifetime purchase activated", {
      userId,
      sessionId: session.id,
    })
    return
  }

  // subscription mode — a Customer is always created by Checkout
  if (!customerId) return

  // Retrieve the full Subscription object for price/period details
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id

  if (!subscriptionId) return

  // Fetch the full subscription object to get price/period details
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  })

  const priceId = sub.items.data[0]?.price?.id ?? ""
  const tier = mapPriceTier(priceId)
  const status = mapStripeStatus(sub.status)
  const currentPeriodEnd = tier === "LIFETIME" ? null : getPeriodEnd(sub)

  await prisma.$transaction(async (tx) => {
    await tx.subscription.upsert({
      where: { userId },
      create: {
        userId,
        tier,
        status,
        stripeCustomerId: customerId,
        stripeSubId: subscriptionId,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
      update: {
        tier,
        status,
        stripeCustomerId: customerId,
        stripeSubId: subscriptionId,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
    })
    // Mirror onto User.subscriptionTier for the fallback lookup path
    await tx.user.update({
      where: { id: userId },
      data: { subscriptionTier: effectiveTier(tier, status) },
    })
  })

  console.info("[stripe/webhook] checkout.session.completed: subscription activated", {
    userId,
    tier,
    status,
    subscriptionId,
  })
}

/**
 * customer.subscription.updated
 *
 * Fired on any subscription change: renewal, upgrade, downgrade, cancellation
 * scheduled, trial end, etc.
 */
async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id

  // metadata.userId is set via subscription_data at checkout, so this also
  // works when the event arrives before checkout.session.completed.
  const userId = await resolveUserId(customerId, sub.metadata)
  if (!userId) {
    console.warn("[stripe/webhook] subscription.updated: no userId found for customer", {
      customerId,
      subId: sub.id,
    })
    return
  }

  const existing = await prisma.subscription.findUnique({
    where: { userId },
    select: { tier: true, stripeSubId: true },
  })
  if (existing?.tier === "LIFETIME") return
  if (existing?.stripeSubId && existing.stripeSubId !== sub.id) {
    console.warn("[stripe/webhook] subscription.updated: ignoring event for superseded subscription", {
      userId,
      subId: sub.id,
    })
    return
  }

  const priceId = sub.items.data[0]?.price?.id ?? ""
  const tier = mapPriceTier(priceId)
  const status = mapStripeStatus(sub.status)
  const currentPeriodEnd = tier === "LIFETIME" ? null : getPeriodEnd(sub)

  await prisma.$transaction(async (tx) => {
    await tx.subscription.upsert({
      where: { userId },
      create: {
        userId,
        tier,
        status,
        stripeCustomerId: customerId,
        stripeSubId: sub.id,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
      update: {
        tier,
        status,
        stripeSubId: sub.id,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
    })
    await tx.user.update({
      where: { id: userId },
      data: { subscriptionTier: effectiveTier(tier, status) },
    })
  })

  console.info("[stripe/webhook] subscription.updated", {
    userId,
    tier,
    status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  })
}

/**
 * customer.subscription.deleted
 *
 * Fired when a subscription is fully cancelled (period ended or immediate cancel).
 * We mark status CANCELLED but never delete the row — preserves audit history.
 */
async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id

  const userId = await resolveUserId(customerId)
  if (!userId) {
    console.warn("[stripe/webhook] subscription.deleted: no userId found for customer", {
      customerId,
      subId: sub.id,
    })
    return
  }

  const existing = await prisma.subscription.findUnique({
    where: { userId },
    select: { tier: true, stripeSubId: true },
  })
  // A lifetime purchase outlives any old subscription; a stale event for a
  // replaced subscription must not cancel the current one.
  if (!existing || existing.tier === "LIFETIME") return
  if (existing.stripeSubId && existing.stripeSubId !== sub.id) return

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { userId },
      data: {
        status: "CANCELLED",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    })
    await tx.user.update({
      where: { id: userId },
      data: { subscriptionTier: "FREE" },
    })
  })

  console.info("[stripe/webhook] subscription.deleted: downgraded to FREE", { userId })
}

/**
 * invoice.payment_failed
 *
 * Fired when a renewal invoice cannot be charged.
 * We mark the subscription PAST_DUE so the gate reflects degraded access.
 * Stripe will keep retrying; if it eventually succeeds, subscription.updated
 * fires and we restore ACTIVE.
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id
  if (!customerId) return

  const userId = await resolveUserId(customerId)
  if (!userId) {
    console.warn("[stripe/webhook] invoice.payment_failed: no userId found for customer", {
      customerId,
      invoiceId: invoice.id,
    })
    return
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.subscription.updateMany({
      where: { userId, tier: { not: "LIFETIME" } },
      data: { status: "PAST_DUE" },
    })
    if (count > 0) {
      await tx.user.update({
        where: { id: userId },
        data: { subscriptionTier: "FREE" },
      })
    }
  })

  console.info("[stripe/webhook] invoice.payment_failed: marked PAST_DUE", { userId })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!stripe) {
    console.error("[stripe/webhook] STRIPE_SECRET_KEY is not configured")
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
  }

  if (!stripeWebhookSecret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not configured")
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
  }

  const sig = req.headers.get("stripe-signature")
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 })
  }

  // Raw body is required for signature verification — do NOT use req.json()
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, stripeWebhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.warn("[stripe/webhook] Signature verification failed:", message)
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break

      default:
        // Acknowledge unhandled events — do not return non-2xx or Stripe will retry
        break
    }
  } catch (err) {
    console.error("[stripe/webhook] Handler error for event", event.type, err)
    // Return 500 so Stripe retries the event
    return NextResponse.json({ error: "Internal handler error" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
