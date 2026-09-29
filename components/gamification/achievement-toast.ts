"use client"

/**
 * AchievementToast — non-blocking reward feedback
 *
 * Replaces CelebrationModal. Uses sonner toast (already configured in app/layout.tsx)
 * displayed at bottom-right, auto-dismissing after 4 seconds.
 *
 * ADHD-UX: Reward feedback without interrupting focus. Toast fires in peripheral
 * vision (bottom-right), requires zero user interaction, and never blocks the screen.
 *
 * prefers-reduced-motion: sonner respects this natively (slide animation is suppressed).
 */

import { toast } from "sonner"
import type { AchievementRarity } from "@/lib/xp"

interface BlockCompleteOptions {
  blockTitle: string
  xpEarned: number
  leveledUp?: boolean
  newLevel?: number
  usedTimer?: boolean
}

interface QuizCompleteOptions {
  blockTitle: string
  xpEarned: number
  passed: boolean
  perfect: boolean
}

interface AchievementUnlockedOptions {
  label: string
  description: string
  icon: string
  xpBonus: number
  rarity: AchievementRarity
}

export function toastBlockComplete({
  blockTitle,
  xpEarned,
  leveledUp,
  newLevel,
  usedTimer,
}: BlockCompleteOptions) {
  // Re-completing an already-completed block earns nothing — don't claim XP
  const description = xpEarned > 0
    ? `+${xpEarned} XP${usedTimer ? " (timer bonus)" : ""} · "${blockTitle}"`
    : `"${blockTitle}"`

  if (leveledUp && newLevel) {
    // Level-up: violet/XP style — the premier reward event
    toast.success(`Level ${newLevel} reached!`, {
      description,
      duration: 5000,
    })
  } else {
    // Standard block completion
    toast.success("Block complete", {
      description,
      duration: 4000,
    })
  }
}

export function toastQuizComplete({
  blockTitle,
  xpEarned,
  passed,
  perfect,
}: QuizCompleteOptions) {
  if (!passed) return

  const title = perfect ? "Perfect score!" : "Quiz passed!"
  const desc = xpEarned > 0
    ? `+${xpEarned} XP · "${blockTitle}"`
    : `"${blockTitle}"`

  toast.success(title, {
    description: desc,
    duration: 4000,
  })
}

export function toastStreakMilestone(days: number) {
  toast(`${days}-day streak!`, {
    description: "Keep the momentum going.",
    duration: 4000,
  })
}

/**
 * toastAchievementUnlocked — fires when an achievement is newly earned.
 *
 * Duration and style vary by rarity:
 *   Common    — 4s, standard success
 *   Rare      — 5s, success
 *   Epic      — 6s, success with extra XP callout
 *   Legendary — 8s, prominent message
 */
export function toastAchievementUnlocked({
  label,
  description,
  icon,
  xpBonus,
  rarity,
}: AchievementUnlockedOptions) {
  const durationByRarity: Record<AchievementRarity, number> = {
    common: 4000,
    rare: 5000,
    epic: 6000,
    legendary: 8000,
  }

  const rarityLabel: Record<AchievementRarity, string> = {
    common: "",
    rare: " · Rare",
    epic: " · Epic",
    legendary: " · Legendary!",
  }

  const title = `${icon} ${label}`
  const desc = `${description}${xpBonus > 0 ? ` · +${xpBonus} XP` : ""}${rarityLabel[rarity]}`

  if (rarity === "legendary") {
    toast(title, {
      description: desc,
      duration: durationByRarity[rarity],
    })
  } else {
    toast.success(title, {
      description: desc,
      duration: durationByRarity[rarity],
    })
  }
}
