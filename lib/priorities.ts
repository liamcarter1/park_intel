// ─── Priority Ride State ──────────────────────────────────────────────────────
//
// Stored in localStorage under the key "parkintel_priorities"
// Shape: { [parkId]: { [rideId]: { priority: boolean, done: boolean } } }
//
// Both the Settings tab (pre-trip setup) and the Park Intel tab (in-park use)
// read and write to this same store so they stay in sync.

export interface RideState {
  priority: boolean
  done: boolean
}

export type ParkPriorities = Record<number, RideState>   // rideId → state
export type AllPriorities  = Record<number, ParkPriorities> // parkId → rides

export const STORAGE_KEY = 'parkintel_priorities'

export function loadPriorities(): AllPriorities {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function savePriorities(data: AllPriorities): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage quota exceeded — fail silently
  }
}

export function togglePriority(
  current: AllPriorities,
  parkId: number,
  rideId: number
): AllPriorities {
  const park = current[parkId] ?? {}
  const ride = park[rideId] ?? { priority: false, done: false }
  return {
    ...current,
    [parkId]: {
      ...park,
      [rideId]: { ...ride, priority: !ride.priority },
    },
  }
}

export function toggleDone(
  current: AllPriorities,
  parkId: number,
  rideId: number
): AllPriorities {
  const park = current[parkId] ?? {}
  const ride = park[rideId] ?? { priority: false, done: false }
  return {
    ...current,
    [parkId]: {
      ...park,
      [rideId]: { ...ride, done: !ride.done },
    },
  }
}

// Summarise priorities for injection into AI prompts
export function summarisePriorities(
  parkId: number,
  priorities: AllPriorities,
  rideNames: Record<number, string>  // rideId → name
): { priorityContext: string; hasPriorities: boolean } {
  const park = priorities[parkId] ?? {}
  const priority = Object.entries(park)
    .filter(([, s]) => s.priority && !s.done)
    .map(([id]) => rideNames[Number(id)])
    .filter(Boolean)

  const done = Object.entries(park)
    .filter(([, s]) => s.done)
    .map(([id]) => rideNames[Number(id)])
    .filter(Boolean)

  if (priority.length === 0 && done.length === 0) {
    return { priorityContext: '', hasPriorities: false }
  }

  const lines: string[] = []
  if (priority.length > 0) {
    lines.push(`PRIORITY RIDES (group still wants to do these): ${priority.join(', ')}`)
  }
  if (done.length > 0) {
    lines.push(`ALREADY DONE (skip these in recommendations): ${done.join(', ')}`)
  }

  return {
    priorityContext: lines.join('\n'),
    hasPriorities: true,
  }
}
