import { NextRequest, NextResponse } from 'next/server'
import { Ride, SYSTEM_PROMPT } from '@/lib/parks'

interface RecommendBody {
  parkName: string
  rides: Ride[]
  currentTimeET: string
  priorityContext?: string  // injected from localStorage priorities
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured.' },
      { status: 500 }
    )
  }

  let body: RecommendBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { parkName, rides, currentTimeET, priorityContext } = body
  if (!parkName || !rides?.length) {
    return NextResponse.json({ error: 'parkName and rides are required' }, { status: 400 })
  }

  // Build date context server-side so the AI can apply seasonal crowd knowledge
  const nowDate = new Date()
  const todayFull = nowDate.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
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

  const openRides = rides.filter((r) => r.is_open)
  const avgWait =
    openRides.length > 0
      ? Math.round(openRides.reduce((s, r) => s + r.wait_time, 0) / openRides.length)
      : 0

  // Mark priority and done status inline in the ride data sent to AI
  const rideData = [...rides]
    .sort((a, b) => Number(b.is_open) - Number(a.is_open) || a.wait_time - b.wait_time)
    .map((r) => {
      const meta = (r as Ride & { _priority?: boolean; _done?: boolean })
      const flags = [
        meta._priority ? '⭐ PRIORITY' : '',
        meta._done     ? '✓ DONE'     : '',
      ].filter(Boolean).join(' ')
      return `${r.is_open ? 'OPEN' : 'CLOSED'} | ${r.wait_time}min | ${r.name} (${r.land})${flags ? ` [${flags}]` : ''}`
    })
    .join('\n')

  const priorityBlock = priorityContext
    ? `\n${priorityContext}\n`
    : ''

  const userMessage = `Park: ${parkName}
Today: ${todayFull}
Current time (ET): ${currentTimeET} — ${timeOfDay}
Open rides: ${openRides.length} of ${rides.length}
Average wait (open rides): ${avgWait} minutes
${priorityBlock}
Apply your knowledge of typical crowd patterns for this park on this specific date and day of week — flag if today appears busier or quieter than usual based on the wait data below.

LIVE WAIT TIME DATA:
${rideData}

Give me your tactical assessment. If priority rides are listed above, lead your GO NOW section with any that have acceptable waits, and flag if any are currently too busy to be worth queuing without a pass.`

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
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    const data = await res.json()
    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    return NextResponse.json({
      recommendation: data.content?.[0]?.text ?? 'No response received.',
    })
  } catch (error) {
    console.error('[/api/recommend] Anthropic call failed:', error)
    return NextResponse.json({ error: 'Failed to get AI recommendation.' }, { status: 502 })
  }
}
