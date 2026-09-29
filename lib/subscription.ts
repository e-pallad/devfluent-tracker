/**
 * lib/subscription.ts — Freemium tier system
 *
 * Sprint 2: Real DB lookup via Subscription model.
 * Falls back to User.subscriptionTier if no Subscription row exists.
 *
 * The ProFeatureGate component uses `isPro()` to determine gate state.
 *
 * Feature flag definitions follow the Unified Design Spec decision:
 *   Pro: Focus sounds, AI recommendations, Accountability partner,
 *        Analytics heatmap, Streak freeze, Body-double mode (free in Sprint 1)
 *   Free (always): Pomodoro timer, block completion, XP, streak,
 *                  roadmap, projects, basic progress stats
 */

import { prisma } from "@/lib/prisma"

export type SubscriptionTier = "FREE" | "PRO" | "LIFETIME"

export interface FeatureFlags {
  focusSounds: boolean
  aiRecommendations: boolean
  accountabilityPartner: boolean
  analyticsHeatmap: boolean
  streakFreeze: boolean
  bodyDoubleMode: boolean
}

/**
 * getUserTier — returns the effective subscription tier for a user.
 *
 * Resolution order:
 * 1. Subscription row, if one exists — authoritative (checks status + period
 *    end), so a lapsed or past-due subscription resolves to FREE
 * 2. User.subscriptionTier field — only when no Subscription row exists
 *    (manual admin overrides)
 * 3. Default: FREE
 */
export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      tier: true,
      status: true,
      currentPeriodEnd: true,
    },
  })

  if (sub) {
    // LIFETIME is always active regardless of dates
    if (sub.tier === "LIFETIME") return "LIFETIME"

    // PRO is active if status is ACTIVE or TRIALING and within period
    const isActive =
      sub.status === "ACTIVE" || sub.status === "TRIALING"
    const withinPeriod =
      !sub.currentPeriodEnd || sub.currentPeriodEnd > new Date()

    if (sub.tier === "PRO" && isActive && withinPeriod) return "PRO"
    return "FREE"
  }

  // No Subscription row: fall back to User.subscriptionTier (manual admin overrides)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true },
  })
  if (user?.subscriptionTier && user.subscriptionTier !== "FREE") {
    return user.subscriptionTier as SubscriptionTier
  }

  return "FREE"
}

/**
 * isPro — convenience boolean check for most gate decisions.
 */
export async function isPro(userId: string): Promise<boolean> {
  const tier = await getUserTier(userId)
  return tier === "PRO" || tier === "LIFETIME"
}

/**
 * getFeatureFlags — returns all feature flag states for a given tier.
 * Use this in Server Components to pass flags as props to Client Components.
 */
export function getFeatureFlags(tier: SubscriptionTier): FeatureFlags {
  const pro = tier === "PRO" || tier === "LIFETIME"
  return {
    focusSounds: pro,
    aiRecommendations: pro,
    accountabilityPartner: pro,
    analyticsHeatmap: pro,
    streakFreeze: true, // Always free — streak freeze auto-activates for all users
    bodyDoubleMode: true, // Always free — community feature
  }
}

/**
 * isFeatureAvailable — check a single feature flag from a tier string.
 * Useful in API routes to gate responses.
 */
export function isFeatureAvailable(
  tier: SubscriptionTier,
  feature: keyof FeatureFlags
): boolean {
  return getFeatureFlags(tier)[feature]
}
