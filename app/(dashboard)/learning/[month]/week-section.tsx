"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { BlockCard } from "@/components/learning/block-card"
import type { LearningBlock } from "@/content/curriculum"
import type { Dictionary } from "@/lib/i18n/dictionaries/en"

interface WeekSectionProps {
  weekNumber: number
  theme: string
  blocks: LearningBlock[]
  statusMap: Record<string, "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED">
  notesMap?: Record<string, string>
  readOnly?: boolean
  dict?: Dictionary
}

export function WeekSection({ weekNumber, theme, blocks, statusMap, notesMap = {}, readOnly = false, dict }: WeekSectionProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const handleComplete = async (blockId: string, usedTimer: boolean) => {
    if (readOnly) return null
    let res: Response
    try {
      res = await fetch("/api/progress/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId, status: "COMPLETED", usedTimer }),
      })
    } catch {
      toast.error("Failed to save progress. Please try again.")
      return null
    }
    if (!res.ok) {
      toast.error("Failed to save progress. Please try again.")
      return null
    }
    const data = await res.json()
    startTransition(() => router.refresh())
    return { xpAwarded: data.xpAwarded, leveledUp: data.leveledUp, newLevel: data.newLevel, achievements: data.achievements ?? [] }
  }

  const handleSkip = async (blockId: string) => {
    if (readOnly) return
    let res: Response
    try {
      res = await fetch("/api/progress/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId, status: "SKIPPED" }),
      })
    } catch {
      toast.error("Failed to save progress. Please try again.")
      return
    }
    if (!res.ok) {
      toast.error("Failed to save progress. Please try again.")
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-white">Week {weekNumber}</h3>
        <span className="text-xs text-zinc-500">{theme}</span>
      </div>
      <div className="space-y-2">
        {blocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            status={statusMap[block.id] ?? "NOT_STARTED"}
            initialNotes={notesMap[block.id] ?? ""}
            onComplete={handleComplete}
            onSkip={handleSkip}
            readOnly={readOnly}
            dict={dict}
          />
        ))}
      </div>
    </div>
  )
}
