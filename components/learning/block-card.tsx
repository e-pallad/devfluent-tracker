"use client"

import { useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PomodoroTimer } from "@/components/learning/pomodoro-timer"
import { toastBlockComplete, toastQuizComplete, toastAchievementUnlocked } from "@/components/gamification/achievement-toast"
import type { UnlockedAchievement } from "@/lib/user"
import { QuizModal } from "@/components/learning/quiz-modal"
import { BLOCK_TYPE_COLORS, BLOCK_TYPE_LABELS, type LearningBlock } from "@/content/curriculum"
import { XP_VALUES } from "@/lib/xp"
import { cn } from "@/lib/utils"
import { ChevronDown, Check, StickyNote } from "lucide-react"
import type { Dictionary } from "@/lib/i18n/dictionaries/en"

interface BlockCardProps {
  block: LearningBlock
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED"
  initialNotes?: string
  /** Resolves to null when saving failed (the caller already showed an error) */
  onComplete?: (blockId: string, usedTimer: boolean) => Promise<{ xpAwarded?: number; leveledUp?: boolean; newLevel?: number; achievements?: UnlockedAchievement[] } | null>
  onSkip?: (blockId: string) => void
  readOnly?: boolean
  dict?: Dictionary
}

export function BlockCard({ block, status, initialNotes = "", onComplete, onSkip, readOnly = false, dict }: BlockCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [timerUsed, setTimerUsed] = useState(false)
  const [showQuiz, setShowQuiz] = useState(false)
  const [notes, setNotes] = useState(initialNotes)
  const [notesSaving, setNotesSaving] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const isCompleted = status === "COMPLETED"
  const isSkipped = status === "SKIPPED"

  const handleComplete = async () => {
    if (readOnly) return
    if (!onComplete || loading) return
    setLoading(true)
    try {
      const result = await onComplete(block.id, timerUsed)
      if (!result) return
      toastBlockComplete({
        blockTitle: block.title,
        // Server-reported XP: 0 when the block had already been completed before
        xpEarned: result.xpAwarded ?? xpValue,
        leveledUp: result.leveledUp,
        newLevel: result.newLevel,
        usedTimer: timerUsed,
      })
      // Fire rarity-aware achievement toasts for any newly unlocked achievements
      if (result.achievements && result.achievements.length > 0) {
        for (const ach of result.achievements) {
          toastAchievementUnlocked(ach)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const handleQuizComplete = (result: {
    xpEarned: number
    passed: boolean
    perfect: boolean
    achievements: UnlockedAchievement[]
  }) => {
    if (result.passed) {
      toastQuizComplete({
        blockTitle: block.title,
        xpEarned: result.xpEarned,
        passed: result.passed,
        perfect: result.perfect,
      })
      if (onComplete && !isCompleted && !loading) {
        setLoading(true)
        onComplete(block.id, timerUsed)
          .then((completion) => completion?.achievements?.forEach(toastAchievementUnlocked))
          .finally(() => setLoading(false))
      }
    }
  }

  const xpValue = timerUsed ? XP_VALUES.COMPLETE_BLOCK_POMODORO : XP_VALUES.COMPLETE_BLOCK
  const hasQuiz = block.quiz && block.quiz.length > 0

  const saveNotes = useCallback(async (value: string) => {
    if (readOnly) return
    setNotesSaving(true)
    try {
      await fetch("/api/progress/block", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: block.id, notes: value }),
      })
    } finally {
      setNotesSaving(false)
    }
  }, [block.id, readOnly])

  return (
    <>
      <Card className={cn(
        "scroll-mt-20",
        "transition-all",
        isCompleted && "border-green-300 bg-green-50",
        isSkipped && "opacity-60"
      )} id={block.id}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {/* Status indicator */}
              <button
                onClick={() => !isCompleted && handleComplete()}
                className={cn(
                  "mt-0.5 flex-shrink-0 p-2 -m-2 rounded-full transition-colors flex items-center justify-center",
                  isCompleted || readOnly ? "cursor-default" : "cursor-pointer hover:opacity-70"
                )}
                aria-label={isCompleted ? "Completed" : "Mark complete"}
                disabled={isCompleted || readOnly}
              >
                <span className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
                  isCompleted ? "border-green-500 bg-green-500" : "border-gray-300 hover:border-indigo-400"
                )}>
                {isCompleted && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={cn(
                    "text-sm font-medium text-gray-900 dark:text-gray-100",
                    isCompleted && "line-through text-gray-500 dark:text-gray-400"
                  )}>
                    {block.title}
                  </h3>
                  <Badge className={BLOCK_TYPE_COLORS[block.type]}>
                    {BLOCK_TYPE_LABELS[block.type]}
                  </Badge>
                  <span className="text-xs text-gray-400">{block.durationMinutes}m</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{block.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Notes toggle */}
              <button
                onClick={() => setShowNotes((v) => !v)}
                className={cn(
                  "p-1.5 rounded-md transition-colors cursor-pointer",
                  showNotes ? "text-indigo-600 bg-indigo-50" : "text-gray-400 hover:text-gray-600",
                  notes && !showNotes && "text-amber-500 hover:text-amber-600"
                )}
                aria-label={showNotes ? "Hide notes" : "Show notes"}
                title="Scratchpad"
              >
                <StickyNote className="w-4 h-4" />
              </button>

              <button
                onClick={() => setExpanded((e) => !e)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 transition-transform cursor-pointer"
                style={{ transform: expanded ? "rotate(180deg)" : undefined }}
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {expanded && !isCompleted && (
            <div className="mt-4 space-y-4 border-t border-gray-100 dark:border-gray-700 pt-4">
              {block.resources && block.resources.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Resources</p>
                  <ul className="space-y-1">
                    {block.resources.map((r) => (
                      <li key={r.url}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          {r.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {readOnly ? (
                <p className="text-xs rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  {dict?.demo.readOnlyMessage || "Demo mode is read-only. Create an account to save notes and progress."}
                </p>
              ) : (
                <div className="flex items-center justify-between">
                  <PomodoroTimer
                    blockTitle={block.title}
                    onComplete={() => setTimerUsed(true)}
                  />
                  <div className="space-y-2 text-right">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      +{xpValue} XP {timerUsed && <span className="text-green-600">(timer bonus!)</span>}
                    </p>
                    {hasQuiz && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setShowQuiz(true)}
                        className="block w-full"
                      >
                        Take quiz
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={handleComplete}
                      loading={loading}
                    >
                      Mark complete
                    </Button>
                    {onSkip && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onSkip(block.id)}
                        className="block w-full text-xs"
                      >
                        Skip for now
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {showNotes && (
            <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                  <StickyNote className="w-3 h-3" />
                  Scratchpad
                </p>
                {notesSaving && <span className="text-xs text-gray-400">Saving…</span>}
              </div>
              <textarea
                className="w-full text-xs text-gray-700 dark:text-gray-300 bg-amber-50 dark:bg-gray-800 border border-amber-200 dark:border-gray-600 rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 placeholder:text-gray-400"
                rows={3}
                placeholder="Capture thoughts, questions, or code snippets…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={(e) => saveNotes(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {showQuiz && hasQuiz && (
        <QuizModal
          blockId={block.id}
          blockTitle={block.title}
          questions={block.quiz!}
          onComplete={handleQuizComplete}
          onClose={() => setShowQuiz(false)}
        />
      )}
    </>
  )
}
