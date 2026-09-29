import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/user"
import Anthropic from "@anthropic-ai/sdk"
import { getTrackById, CURRICULUM } from "@/content/curriculum"
import { isDemoUser } from "@/lib/demo"
import { getUserTier, isFeatureAvailable } from "@/lib/subscription"

const CACHE_HOURS = 24
const MAX_RECOMMENDATIONS = 5
const PRIORITIES = new Set(["high", "medium", "low"])

interface Recommendation {
  title: string
  description: string
  priority: "high" | "medium" | "low"
  icon: string
}

const DEMO_RECOMMENDATIONS: Recommendation[] = [
  {
    title: "Finish week one",
    description: "Explore all week 1 blocks to see how lessons and quizzes feel.",
    priority: "high",
    icon: "🚀",
  },
  {
    title: "Try one Pomodoro",
    description: "Open a block and run a focus timer to preview the flow.",
    priority: "medium",
    icon: "⏱️",
  },
  {
    title: "Create account to save",
    description: "Sign up when ready to keep XP, streaks, and notes across sessions.",
    priority: "low",
    icon: "✨",
  },
]

async function generateRecommendations(userId: string): Promise<Recommendation[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      quizAttempts: { orderBy: { attemptedAt: "desc" }, take: 5 },
      blockProgress: { where: { status: "COMPLETED" } },
      dailyLogs: { orderBy: { date: "desc" }, take: 7 },
    },
  })
  if (!user) return []

  const curriculum = getTrackById(user.track)?.months ?? CURRICULUM
  const totalBlocks = curriculum.flatMap((m) => m.weeks.flatMap((w) => w.blocks)).length
  const completedBlocks = user.blockProgress.length

  // Current month (first month with incomplete blocks)
  let currentMonth = 1
  for (const m of curriculum) {
    const monthBlocks = m.weeks.flatMap((w) => w.blocks.map((b) => b.id))
    const done = user.blockProgress.filter((bp) => monthBlocks.includes(bp.blockId)).length
    if (done < monthBlocks.length) {
      currentMonth = m.month
      break
    }
  }

  const recentScores = user.quizAttempts.map((q) => q.score).join(", ") || "none yet"
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayLog = user.dailyLogs.find(
    (l) => new Date(l.date).toDateString() === today.toDateString()
  )
  const weeklyBlocks = user.dailyLogs.reduce((s, l) => s + l.blocksCompleted, 0)

  const prompt = `You are a learning coach for a developer learning platform. Based on this learner's data, provide 3 specific, actionable recommendations. Reply ONLY with a JSON array of objects with keys: title (string, max 8 words), description (string, max 20 words), priority ("high"|"medium"|"low"), icon (single emoji).

Learner data:
- Track: ${user.track}
- Level: ${user.level}, Total XP: ${user.totalXP}
- Streak: ${user.streak} days
- Blocks completed: ${completedBlocks}/${totalBlocks} (month ${currentMonth})
- Recent quiz scores: ${recentScores}
- Daily goal: ${todayLog?.blocksCompleted ?? 0}/${user.dailyGoalBlocks} blocks today
- Weekly goal: ${weeklyBlocks}/${user.weeklyGoalBlocks} blocks this week`

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  })

  const text = message.content[0]?.type === "text" ? message.content[0].text : ""
  // Extract JSON array from response (may have markdown fences)
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  return sanitizeRecommendations(JSON.parse(match[0]))
}

/** Keep only well-formed items so a malformed model reply can't break the widget. */
function sanitizeRecommendations(value: unknown): Recommendation[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Recommendation =>
      typeof item === "object" && item !== null &&
      typeof item.title === "string" && item.title.length > 0 &&
      typeof item.description === "string" &&
      typeof item.icon === "string" &&
      PRIORITIES.has(item.priority)
    )
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ title, description, priority, icon }) => ({
      title: title.slice(0, 100),
      description: description.slice(0, 300),
      priority,
      icon: icon.slice(0, 8),
    }))
}

function parseCached(content: string): Recommendation[] {
  try {
    return sanitizeRecommendations(JSON.parse(content))
  } catch {
    return []
  }
}

async function getOrGenerateRecommendations(userId: string): Promise<NextResponse> {
  try {
    const recommendations = await generateRecommendations(userId)
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + CACHE_HOURS)

    await prisma.aiRecommendation.upsert({
      where: { userId },
      create: { userId, content: JSON.stringify(recommendations), expiresAt },
      update: { content: JSON.stringify(recommendations), generatedAt: new Date(), expiresAt },
    })

    return NextResponse.json({ recommendations, cached: false })
  } catch (err) {
    console.error("[ai/recommendations] Generation failed", err)
    // Serve the previous (possibly expired) recommendations rather than nothing
    const stale = await prisma.aiRecommendation.findUnique({ where: { userId } }).catch(() => null)
    return NextResponse.json({ recommendations: stale ? parseCached(stale.content) : [], cached: Boolean(stale) })
  }
}

/** AI coaching is a Pro feature — enforce it here, not just in the UI (each call costs money). */
async function hasAiAccess(userId: string): Promise<boolean> {
  return isFeatureAvailable(await getUserTier(userId), "aiRecommendations")
}

const PRO_REQUIRED = { error: "AI recommendations are a Pro feature" }

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ recommendations: DEMO_RECOMMENDATIONS, cached: true })
  }
  if (!(await hasAiAccess(user.id))) {
    return NextResponse.json(PRO_REQUIRED, { status: 403 })
  }

  // Return cached recommendation if still valid
  const cached = await prisma.aiRecommendation.findUnique({ where: { userId: user.id } })
  if (cached && new Date(cached.expiresAt) > new Date()) {
    return NextResponse.json({
      recommendations: parseCached(cached.content),
      cached: true,
    })
  }

  return getOrGenerateRecommendations(user.id)
}

export async function POST() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (isDemoUser(user)) {
    return NextResponse.json({ recommendations: DEMO_RECOMMENDATIONS, cached: true })
  }
  if (!(await hasAiAccess(user.id))) {
    return NextResponse.json(PRO_REQUIRED, { status: 403 })
  }

  // Rate-limit forced regeneration to once per hour (prevents unbounded API cost).
  // The cached row is kept until a new result replaces it, so a failed
  // generation can't erase the rate-limit marker.
  const existing = await prisma.aiRecommendation.findUnique({ where: { userId: user.id } })
  if (existing) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    if (existing.generatedAt > oneHourAgo) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 })
    }
  }

  return getOrGenerateRecommendations(user.id)
}
