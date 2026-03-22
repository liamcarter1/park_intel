import { NextRequest, NextResponse } from 'next/server'
import { flattenRides, QueueTimesResponse } from '@/lib/parks'

// This runs SERVER-SIDE on Vercel — no CORS issues whatsoever.
// The browser never touches queue-times.com directly.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const parkId = searchParams.get('parkId')

  if (!parkId || isNaN(Number(parkId))) {
    return NextResponse.json({ error: 'Invalid parkId' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://queue-times.com/parks/${parkId}/queue_times.json`,
      {
        // Revalidate every 5 minutes — Queue-Times updates on this cadence anyway
        next: { revalidate: 300 },
        headers: {
          // Identify ourselves politely to the API
          'User-Agent': 'ParkIntel/1.0 (personal trip planning app)',
        },
      }
    )

    if (!res.ok) {
      return NextResponse.json(
        { error: `Queue-Times returned ${res.status}` },
        { status: res.status }
      )
    }

    const data: QueueTimesResponse = await res.json()
    const rides = flattenRides(data)

    return NextResponse.json({ rides, fetchedAt: new Date().toISOString() })
  } catch (error) {
    console.error('[/api/waits] Fetch failed:', error)
    return NextResponse.json(
      { error: 'Failed to fetch wait times. Queue-Times may be temporarily unavailable.' },
      { status: 502 }
    )
  }
}
