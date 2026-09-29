import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/user"
import { getUserTier, isFeatureAvailable } from "@/lib/subscription"

// Partnerships are consent-based: a pair row (requester → partner) is an
// invitation, and two users are linked only once both have added each other.
// Nothing about another user is revealed until the link is mutual.

const PRO_REQUIRED = { error: "Accountability partners are a Pro feature" }
const INVITE_MESSAGE =
  "If that email belongs to a Devfluent account, they'll see your request. You're linked once they add you back."

async function hasAccess(userId: string): Promise<boolean> {
  return isFeatureAvailable(await getUserTier(userId), "accountabilityPartner")
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await hasAccess(user.id))) return NextResponse.json(PRO_REQUIRED, { status: 403 })

  const { partnerEmail } = await req.json() as { partnerEmail?: string }
  if (!partnerEmail || typeof partnerEmail !== "string" || partnerEmail.length > 254) {
    return NextResponse.json({ error: "partnerEmail required" }, { status: 400 })
  }

  // Prevent self-linking
  if (partnerEmail.trim().toLowerCase() === user.email.toLowerCase()) {
    return NextResponse.json({ error: "Cannot partner with yourself" }, { status: 400 })
  }

  const partner = await prisma.user.findUnique({ where: { email: partnerEmail.trim().toLowerCase() } })

  if (partner && partner.id !== user.id) {
    await prisma.accountabilityPair.upsert({
      where: { requesterId_partnerId: { requesterId: user.id, partnerId: partner.id } },
      create: { requesterId: user.id, partnerId: partner.id },
      update: {},
    })
  }

  // Identical response whether or not the email exists — no account enumeration
  return NextResponse.json({ success: true, message: INVITE_MESSAGE })
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await hasAccess(user.id))) return NextResponse.json(PRO_REQUIRED, { status: 403 })

  const [pair, incoming] = await Promise.all([
    // Mutual link: I added them and they added me back
    prisma.accountabilityPair.findFirst({
      where: { requesterId: user.id, partner: { sentPairs: { some: { partnerId: user.id } } } },
      orderBy: { createdAt: "asc" },
      include: {
        partner: { select: { id: true, name: true, email: true, streak: true, level: true, totalXP: true, weeklyGoalBlocks: true } },
      },
    }),
    // Requests to me that I haven't answered by adding them back
    prisma.accountabilityPair.findMany({
      where: { partnerId: user.id, requester: { receivedPairs: { none: { requesterId: user.id } } } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { requester: { select: { name: true, email: true } } },
    }),
  ])

  const incomingRequests = incoming.map((p) => ({ id: p.id, name: p.requester.name, email: p.requester.email }))

  if (!pair) return NextResponse.json({ partner: null, incoming: incomingRequests })

  const partnerUser = pair.partner

  // Get partner's weekly blocks
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)
  const partnerLogs = await prisma.dailyLog.findMany({
    where: { userId: partnerUser.id, date: { gte: sevenDaysAgo } },
  })
  const partnerWeeklyBlocks = partnerLogs.reduce((s, l) => s + l.blocksCompleted, 0)

  return NextResponse.json({
    partner: {
      name: partnerUser.name,
      email: partnerUser.email,
      streak: partnerUser.streak,
      level: partnerUser.level,
      totalXP: partnerUser.totalXP,
      weeklyBlocks: partnerWeeklyBlocks,
      weeklyGoal: partnerUser.weeklyGoalBlocks,
    },
    incoming: incomingRequests,
  })
}

// No Pro check: unlinking and declining must always work, even after a downgrade.
//   DELETE                       → remove every link and invitation involving me
//   DELETE ?requestId=<pairId>   → decline one incoming request
export async function DELETE(req?: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const requestId = req?.nextUrl.searchParams.get("requestId")
  if (requestId) {
    await prisma.accountabilityPair.deleteMany({ where: { id: requestId, partnerId: user.id } })
    return NextResponse.json({ success: true })
  }

  await prisma.accountabilityPair.deleteMany({
    where: { OR: [{ requesterId: user.id }, { partnerId: user.id }] },
  })
  return NextResponse.json({ success: true })
}
