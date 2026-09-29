"use client"
import { useEffect, useState } from "react"
import { ProgressBar } from "@/components/ui/progress-bar"
import { ProFeatureGate } from "@/components/ui/pro-feature-gate"

interface PartnerStats {
  name: string | null
  email: string
  streak: number
  level: number
  totalXP: number
  weeklyBlocks: number
  weeklyGoal: number
}

interface IncomingRequest {
  id: string
  name: string | null
  email: string
}

interface AccountabilityResponse {
  partner: PartnerStats | null
  incoming?: IncomingRequest[]
}

interface AccountabilityPartnerProps {
  isProUser?: boolean
}

export function AccountabilityPartner({ isProUser = false }: AccountabilityPartnerProps) {
  const [partner, setPartner] = useState<PartnerStats | null>(null)
  const [incoming, setIncoming] = useState<IncomingRequest[]>([])
  const [loading, setLoading] = useState(isProUser)
  const [email, setEmail] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = () =>
    fetch("/api/accountability")
      .then(r => (r.ok ? r.json() as Promise<AccountabilityResponse> : null))
      .then(d => {
        if (!d) return
        setPartner(d.partner)
        setIncoming(d.incoming ?? [])
      })

  useEffect(() => {
    // Pro-only: free users see the muted preview without hitting the API
    if (!isProUser) return
    reload().catch(() => {}).finally(() => setLoading(false))
  }, [isProUser])

  const invite = async (partnerEmail: string) => {
    setConnecting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/accountability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerEmail }),
      })
      const data = await res.json() as { error?: string; message?: string }
      if (!res.ok) { setError(data.error ?? "Failed to connect"); return }
      setNotice(data.message ?? null)
      setEmail("")
      await reload()
    } catch {
      setError("Failed to connect")
    } finally {
      setConnecting(false)
    }
  }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    void invite(email)
  }

  const handleDecline = async (requestId: string) => {
    await fetch(`/api/accountability?requestId=${encodeURIComponent(requestId)}`, { method: "DELETE" })
    setIncoming(prev => prev.filter(r => r.id !== requestId))
  }

  const handleRemove = async () => {
    await fetch("/api/accountability", { method: "DELETE" })
    setPartner(null)
    setIncoming([])
  }

  if (loading) return <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />

  return (
    <ProFeatureGate featureName="Accountability Partner" isLocked={!isProUser}>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Accountability Partner</h3>
        {partner ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{partner.name ?? partner.email}</p>
                <p className="text-xs text-gray-400">Level {partner.level} · {partner.streak} day streak</p>
              </div>
              <button onClick={handleRemove} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Remove</button>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>This week</span>
                <span>{partner.weeklyBlocks}/{partner.weeklyGoal} blocks</span>
              </div>
              <ProgressBar
                value={partner.weeklyGoal > 0 ? Math.min(100, Math.round((partner.weeklyBlocks / partner.weeklyGoal) * 100)) : 0}
                color={partner.weeklyBlocks >= partner.weeklyGoal ? "green" : "indigo"}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {incoming.length > 0 && (
              <ul className="space-y-2">
                {incoming.map(r => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-indigo-500/30 px-3 py-2">
                    <p className="text-xs text-gray-700 dark:text-gray-300 min-w-0 truncate">
                      <span className="font-medium">{r.name ?? r.email}</span> wants to be your study buddy
                    </p>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => invite(r.email)}
                        disabled={connecting}
                        className="text-xs font-medium text-indigo-500 hover:text-indigo-400 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button onClick={() => handleDecline(r.id)} className="text-xs text-gray-400 hover:text-red-500">
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleAdd} className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">Invite a study buddy by their account email. You&apos;re linked once they add you back.</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="partner@email.com"
                  required
                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  type="submit"
                  disabled={connecting}
                  className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {connecting ? "..." : "Add"}
                </button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              {notice && <p className="text-xs text-gray-500 dark:text-gray-400">{notice}</p>}
            </form>
          </div>
        )}
      </div>
    </ProFeatureGate>
  )
}
