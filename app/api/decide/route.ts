import { NextRequest, NextResponse } from 'next/server'
import { PARKS, flattenRides, QueueTimesResponse } from '@/lib/parks'

const GROUP_PROFILE = `
GROUP PROFILE (all advice must be personalised to this):
- Adults only, no children
- Goal: experience the best thrill rides — quality over quantity
- Relaxed pace: 4-5 brilliant rides beats 10 mediocre ones
- NO Lightning Lane, NO Express Pass — standby queues only for every ride
- Travelling from a villa (all Orlando parks ~25-35 min drive)
- Happy to rope drop or stay late to beat queues — off-peak timing is their main weapon
- No height/intensity restrictions — all rides are fair game
- A 60+ min wait is rarely worth it without a skip-the-line pass unless the ride is truly exceptional
- Single rider lines at Universal are always worth flagging
`

const DECIDE_PROMPT = `You are an elite Orlando theme park strategist. You will receive live wait time snapshots from all major Orlando theme parks fetched simultaneously.

Your job: give one clear, opinionated recommendation on which park this group should go to RIGHT NOW, with specific reasoning from the live data.

${GROUP_PROFILE}

For each park you receive:
- Number of rides open
- Average wait time across open rides
- Top 5 rides sorted by shortest wait
- Longest current wait (crowd indicator)
- Any priority rides the group still wants to do at that park

Scoring framework — apply this internally, do not show it in your response:
- Lower average standby wait = significantly better for a no-pass group
- Signature thrill rides (Tron, Hagrid's, VelociCoaster, Guardians, Harry Potter Battle at Ministry, Stardust Racers) with waits under 40 min = major bonus
- Any signature ride over 75 min standby = major penalty — not worth it without a pass
- If a park has priority rides with short waits right now = strong bonus — this is a rare window
- Universal single rider lines available = moderate bonus (partially offsets no Express Pass)
- Parks with high closure count = penalty
- Time of day: morning favours rope drop, late afternoon/evening favours parks with good night atmosphere and thinning crowds
- Factor in that without any passes, this group feels every minute of every queue

Always respond in EXACTLY this format:

🏆 GO TO: [PARK NAME]

💡 WHY
[3-4 sentences of direct, specific reasoning using the actual live wait data. Name specific rides and their exact waits. If priority rides are available at short waits, call this out explicitly. Be opinionated — don't hedge.]

📊 PARK SNAPSHOT
[One line per park: EMOJI PARK NAME — avg Xmin wait, N rides open. Best standby opportunity: RIDE NAME at Ymin]

⚠️ AVOID TODAY
[Which park to avoid, the specific data-backed reason, and what makes it particularly bad for a no-pass group right now]

⏰ TIMING TIP
[One sentence of tactical timing advice specific to the current time of day and the recommended park — e.g. rope drop windows, single rider lines, when queues are likely to shift]`

async function fetchParkSnapshot(parkId: number): Promise<{
  parkId: number
  rides: ReturnType<typeof flattenRides>
  error?: string
}> {
  try {
    const res = await fetch(
      `https://queue-times.com/parks/${parkId}/queue_times.json`,
      {
        next: { revalidate: 300 },
        headers: { 'User-Agent': 'ParkIntel/1.0 (personal trip planning app)' },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: QueueTimesResponse = await res.json()
    return { parkId, rides: flattenRides(data) }
  } catch (e) {
    return { parkId, rides: [], error: e instanceof Error ? e.message : 'Failed' }
  }
}

// POST so the client can send priority context from localStorage
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Read priority context sent from the client — gracefully optional
  let priorityContext = ''
  try {
    const body = await request.json()
    priorityContext = body?.priorityContext ?? ''
  } catch {
    // No body is fine — just no priority context
  }

  // Fetch all 7 parks in parallel
  const snapshots = await Promise.all(PARKS.map((p) => fetchParkSnapshot(p.id)))

  const parkSummaries: string[] = []
  const parkDetails: { park: typeof PARKS[0]; openCount: number; avgWait: number; snapshot: string }[] = []

  for (const { parkId, rides, error } of snapshots) {
    const park = PARKS.find((p) => p.id === parkId)!
    if (error || rides.length === 0) {
      parkSummaries.push(`${park.emoji} ${park.name}: DATA UNAVAILABLE`)
      parkDetails.push({ park, openCount: 0, avgWait: 0, snapshot: 'Unavailable' })
      continue
    }

    const open = rides.filter((r) => r.is_open)
    const avgWait = open.length > 0
      ? Math.round(open.reduce((s, r) => s + r.wait_time, 0) / open.length)
      : 0
    const shortest = [...open].sort((a, b) => a.wait_time - b.wait_time).slice(0, 5)
    const longest  = [...open].sort((a, b) => b.wait_time - a.wait_time)[0]

    const summary = [
      `${park.emoji} ${park.name} (${park.resort})`,
      `  Open rides: ${open.length}/${rides.length}`,
      `  Average wait: ${avgWait} min`,
      `  Shortest waits: ${shortest.map((r) => `${r.name} (${r.wait_time}min)`).join(', ')}`,
      `  Longest wait: ${longest ? `${longest.name} (${longest.wait_time}min)` : 'N/A'}`,
    ].join('\n')

    parkSummaries.push(summary)
    parkDetails.push({ park, openCount: open.length, avgWait, snapshot: `${open.length} open, avg ${avgWait}min` })
  }

  const nowDate = new Date()

  const now = nowDate.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
  })

  // Full date context so Claude can apply its knowledge of seasonal/day-of-week
  // crowd patterns — e.g. "Saturday in spring break week" vs "Tuesday in May"
  const todayFull = nowDate.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Derive the hour in ET so Claude can reason about time-of-day crowd dynamics
  const hourET = parseInt(
    nowDate.toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    })
  )
  const timeOfDay =
    hourET < 10 ? 'early morning (rope drop window)' :
    hourET < 12 ? 'late morning (crowds building)' :
    hourET < 14 ? 'midday (peak crowd period)' :
    hourET < 17 ? 'mid-afternoon (typically peak or just past peak)' :
    hourET < 19 ? 'late afternoon (crowds often starting to thin)' :
                  'evening (late crowds, parks approaching close)'

  const dayOfWeek = nowDate.toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'long',
  })

  const priorityBlock = priorityContext
    ? `\nGROUP PRIORITY RIDES (factor these heavily into your recommendation):\n${priorityContext}\n`
    : ''

  const userMessage = `Today: ${todayFull}
Current time (ET): ${now} — ${timeOfDay}
${priorityBlock}
Use your knowledge of Orlando theme park crowd patterns for this specific date and day of week. Consider:
- Whether today is a historically busy or quiet day (school holidays, local events, typical ${dayOfWeek} patterns)
- Whether the current time of day represents a good or bad window for a no-pass group
- How the live wait data below compares to what you would typically expect for this date and time

LIVE PARK SNAPSHOTS (all fetched simultaneously):

${parkSummaries.join('\n\n')}

Which park should this group go to right now?`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: DECIDE_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    const data = await res.json()
    if (data.error) throw new Error(data.error.message)

    return NextResponse.json({
      recommendation: data.content?.[0]?.text ?? 'No response.',
      parkDetails,
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI request failed' },
      { status: 502 }
    )
  }
}
