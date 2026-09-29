"use client"
import { useEffect, useRef, useState } from "react"
import { ProFeatureGate } from "@/components/ui/pro-feature-gate"

interface Recommendation {
  title: string
  description: string
  priority: "high" | "medium" | "low"
  icon: string
}

type ResponseData = { recommendations: Recommendation[] }

function fetchRecommendations(force: boolean): Promise<Recommendation[]> {
  return fetch("/api/ai/recommendations", { method: force ? "POST" : "GET" })
    .then((r) => (r.ok ? (r.json() as Promise<ResponseData>) : Promise.resolve({ recommendations: [] })))
    .then((d) => d.recommendations)
    .catch(() => [])
}

// Static sample shown (muted) behind the Pro gate — free users never hit the API
const PREVIEW_RECOMMENDATIONS: Recommendation[] = [
  { title: "Finish this week's blocks", description: "Two blocks left to hit your weekly goal.", priority: "high", icon: "🎯" },
  { title: "Revisit a tricky quiz", description: "Retake the quiz you scored lowest on.", priority: "medium", icon: "📝" },
  { title: "Protect your streak", description: "A short block today keeps momentum going.", priority: "low", icon: "🔥" },
]

interface AiRecommendationsProps {
  isProUser?: boolean
}

export function AiRecommendations({ isProUser = false }: AiRecommendationsProps) {
  const [recs, setRecs] = useState<Recommendation[]>(isProUser ? [] : PREVIEW_RECOMMENDATIONS)
  const [loading, setLoading] = useState(isProUser)
  const [refreshing, setRefreshing] = useState(false)
  const initialFetched = useRef(false)

  useEffect(() => {
    if (!isProUser || initialFetched.current) return
    initialFetched.current = true
    fetchRecommendations(false)
      .then((data) => { setRecs(data) })
      .finally(() => { setLoading(false) })
  }, [isProUser])

  function handleRefresh() {
    if (!isProUser) return
    setRefreshing(true)
    fetchRecommendations(true)
      .then((data) => { setRecs(data) })
      .finally(() => { setRefreshing(false) })
  }

  if (loading)
    return (
      <ProFeatureGate featureName="AI Coach" isLocked={!isProUser}>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
      </ProFeatureGate>
    )

  if (recs.length === 0)
    return (
      <ProFeatureGate featureName="AI Coach" isLocked={!isProUser}>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Coach</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">No recommendations yet.</p>
        </div>
      </ProFeatureGate>
    )

  const priorityBadge: Record<Recommendation["priority"], string> = {
    high: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    medium: "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    low: "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
  }

  return (
    <ProFeatureGate featureName="AI Coach" isLocked={!isProUser}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Coach</h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50 transition-colors"
          >
            {refreshing ? "Thinking..." : "Refresh"}
          </button>
        </div>
        <ul className="space-y-2">
          {recs.map((r, i) => (
            <li
              key={i}
              className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700"
            >
              <span className="text-lg leading-none mt-0.5">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.title}</p>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityBadge[r.priority]}`}
                  >
                    {r.priority}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </ProFeatureGate>
  )
}
