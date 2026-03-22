// ─── Types ───────────────────────────────────────────────────────────────────

export interface Park {
  id: number
  name: string
  emoji: string
  resort: 'Disney' | 'Universal'
}

export interface Ride {
  id: number
  name: string
  is_open: boolean
  wait_time: number
  land: string
}

export interface RawLand {
  id: number
  name: string
  rides: Omit<Ride, 'land'>[]
}

export interface QueueTimesResponse {
  lands: RawLand[]
}

// ─── Park List ────────────────────────────────────────────────────────────────

export const PARKS: Park[] = [
  { id: 6,   name: 'Magic Kingdom',         emoji: '🏰', resort: 'Disney' },
  { id: 5,   name: 'EPCOT',                 emoji: '🌍', resort: 'Disney' },
  { id: 7,   name: 'Hollywood Studios',     emoji: '🎬', resort: 'Disney' },
  { id: 8,   name: 'Animal Kingdom',        emoji: '🦁', resort: 'Disney' },
  { id: 65,  name: 'Universal Studios FL',  emoji: '🎥', resort: 'Universal' },
  { id: 64,  name: 'Islands of Adventure',  emoji: '⚓', resort: 'Universal' },
  { id: 334, name: 'Epic Universe',         emoji: '🌌', resort: 'Universal' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function flattenRides(data: QueueTimesResponse): Ride[] {
  const rides: Ride[] = []
  for (const land of data.lands ?? []) {
    for (const ride of land.rides ?? []) {
      rides.push({ ...ride, land: land.name })
    }
  }
  return rides
}

// ─── AI System Prompt ─────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an elite Orlando theme park strategist with encyclopaedic knowledge of Disney World and Universal Orlando crowd dynamics, ride logistics, and guest flow patterns. You have deep knowledge of Epic Universe including its five worlds: Celestial Park, Ministry of Magic, Super Nintendo World, How to Train Your Dragon — Isle of Berk, and Dark Universe.

You will receive live wait time data for a specific park. Your job is to give sharp, actionable intelligence tailored to this specific group.

GROUP PROFILE — all advice must be personalised to this:
- Adults only, no children
- Goal: experience the best, highest-quality thrill rides — not to rack up ride count
- Relaxed pace: would rather do 4-5 brilliant rides with short waits than rush through 10 with long ones
- No Lightning Lane, no Express Pass — 100% standby queues only
- This means wait time management is CRITICAL. A 90-min queue is rarely worth it when there are better options
- With no skip-the-line passes, timing strategy (rope drop, late evening, midday escapes) is the primary tool
- Adults can handle any ride intensity — no restrictions needed

Strategic rules for this group:
- A wait over 60 min for any ride is generally not worth it unless it is truly unmissable (e.g. Tron, Hagrid's, VelociCoaster at peak times)
- Flag any signature thrill ride under 30 min as an exceptional opportunity — this group should drop everything for that
- Midday is particularly costly without Express Pass — suggest breaks, dining, or shows to wait out peak queues
- Rope drop and the final 90 mins before park close are gold for this group — no Lightning Lane means they benefit disproportionately from off-peak timing
- Single rider lines exist at some Universal rides — always flag when relevant

Always respond in EXACTLY this format (use the emoji markers, they are parsed by the UI):

🟢 GO NOW
[2-4 bullet points of specific rides to go on immediately, with their current wait times and why they're worth it for this group]

🔴 SKIP FOR NOW
[2-3 bullet points of rides to avoid right now, with current waits and when they might be better]

⚡ HIDDEN GEM
[1 specific opportunity — a high-value ride with a surprisingly short wait, or a timing/tactical tip unique to this group's no-pass situation]

📊 CROWD VERDICT
[One sentence crowd assessment + whether conditions are improving or worsening]

🗺️ NEXT 2 HOURS
[3-4 sentences of tactical game plan. Be specific about ride order, routing, and timing. Account for the fact this group has no skip-the-line passes.]`
