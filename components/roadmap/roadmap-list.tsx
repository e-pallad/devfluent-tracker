"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { RoadmapNodeItem } from "@/components/roadmap/roadmap-node-item"
import { ProgressBar } from "@/components/ui/progress-bar"
import type { RoadmapSection } from "@/lib/roadmap"

type NodeStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED"

interface RoadmapListProps {
  sections: RoadmapSection[]
  roadmapId: string
  initialProgress: Record<string, NodeStatus>
}

export function RoadmapList({ sections, roadmapId, initialProgress }: RoadmapListProps) {
  const [progress, setProgress] = useState<Record<string, NodeStatus>>(initialProgress)
  const [, startTransition] = useTransition()

  const handleStatusChange = (nodeId: string, status: NodeStatus) => {
    const previous = progress[nodeId] ?? "NOT_STARTED"
    setProgress((prev) => ({ ...prev, [nodeId]: status }))

    startTransition(async () => {
      const node = sections
        .flatMap((s) => [s.topic, ...s.subtopics])
        .find((n) => n.id === nodeId)
      if (!node) return

      const res = await fetch("/api/progress/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roadmapId, nodeId, nodeLabel: node.label, nodeType: node.type, status }),
      }).catch(() => null)

      // Roll back the optimistic update so the UI never shows unsaved progress
      if (!res?.ok) {
        setProgress((prev) => ({ ...prev, [nodeId]: previous }))
        toast.error("Couldn't save progress. Please try again.")
      }
    })
  }

  const allNodes = sections.flatMap((s) => [s.topic, ...s.subtopics])
  const completed = allNodes.filter((n) => progress[n.id] === "COMPLETED").length
  const progressPct = allNodes.length > 0 ? Math.round((completed / allNodes.length) * 100) : 0

  return (
    <div className="space-y-4">
      <ProgressBar
        value={progressPct}
        label={`${completed} / ${allNodes.length} topics completed`}
        showPercentage
        color="indigo"
      />

      <p className="text-xs text-gray-400">Click any item to cycle: not started → in progress → completed → skipped</p>

      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.topic.id} className="space-y-1">
            <RoadmapNodeItem
              node={section.topic}
              status={progress[section.topic.id] ?? "NOT_STARTED"}
              onStatusChange={handleStatusChange}
            />
            {section.subtopics.map((sub) => (
              <RoadmapNodeItem
                key={sub.id}
                node={sub}
                status={progress[sub.id] ?? "NOT_STARTED"}
                onStatusChange={handleStatusChange}
                indent
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
