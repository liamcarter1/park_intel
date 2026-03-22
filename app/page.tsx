'use client'

import { useState, useEffect, useCallback } from 'react'
import { PARKS, Park, Ride } from '@/lib/parks'
import {
  AllPriorities, loadPriorities, savePriorities,
  togglePriority, toggleDone, summarisePriorities,
} from '@/lib/priorities'
import { WaitBadge } from './components/WaitBadge'
import { AIResponse } from './components/AIResponse'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParkDetail {
  park: Park
  openCount: number
  avgWait: number
  snapshot: string
}

interface DecideResult {
  recommendation: string
  parkDetails: ParkDetail[]
  fetchedAt: string
}

type Tab = 'decide' | 'intel' | 'settings'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getETTime() {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
  })
}

function buildPriorityContext(priorities: AllPriorities): string {
  const lines: string[] = []
  for (const park of PARKS) {
    const pp = priorities[park.id] ?? {}
    const priorityRides = Object.entries(pp)
      .filter(([, s]) => s.priority && !s.done)
      .map(([id]) => {
        // We don't have ride names here — just IDs. The client sends names separately.
        return id
      })
    if (priorityRides.length > 0) {
      lines.push(`${park.name}: ${priorityRides.join(', ')} (ride IDs — names resolved client-side)`)
    }
  }
  return lines.join('\n')
}

// ─── Decide Response Parser ───────────────────────────────────────────────────

function DecideResponse({ text }: { text: string }) {
  const sections = [
    { key: '🏆 GO TO:',        color: '#00ff88', bg: '#00ff8815', border: '#00ff8840' },
    { key: '💡 WHY',           color: '#ffd700', bg: '#ffd70011', border: '#ffd70033' },
    { key: '📊 PARK SNAPSHOT', color: '#60a5fa', bg: '#60a5fa11', border: '#60a5fa33' },
    { key: '⚠️ AVOID TODAY',   color: '#ff3366', bg: '#ff336611', border: '#ff336633' },
    { key: '⏰ TIMING TIP',    color: '#c084fc', bg: '#c084fc11', border: '#c084fc33' },
  ]
  const parsed: { title: string; content: string; color: string; bg: string; border: string; big?: boolean }[] = []
  for (let i = 0; i < sections.length; i++) {
    const { key, ...styles } = sections[i]
    const nextKey = sections[i + 1]?.key
    const start = text.indexOf(key)
    if (start === -1) continue
    const end = nextKey ? text.indexOf(nextKey) : text.length
    const content = text.slice(start + key.length, end === -1 ? undefined : end).trim()
    parsed.push({ title: key, content, ...styles, big: i === 0 })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {parsed.map(({ title, content, color, bg, border, big }) => (
        <div key={title} style={{
          background: bg, border: `1px solid ${border}`,
          borderRadius: '14px', padding: big ? '20px 18px' : '14px 16px',
          borderLeft: `3px solid ${color}`,
        }}>
          <div style={{ color, fontWeight: 800, fontSize: '12px', marginBottom: big ? '10px' : '8px', letterSpacing: '0.5px' }}>
            {title}
          </div>
          <div style={{ color: big ? '#fff' : '#c8d0e0', fontSize: big ? '22px' : '14px', fontWeight: big ? 800 : 400, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {content}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Park Snapshot Card ───────────────────────────────────────────────────────

function SnapshotCard({ detail }: { detail: ParkDetail }) {
  const { park, openCount, avgWait } = detail
  const color = avgWait === 0 ? '#334155' : avgWait <= 25 ? '#00ff88' : avgWait <= 45 ? '#ffd700' : '#ff3366'
  return (
    <div style={{ background: '#0d1520', border: `1px solid ${color}33`, borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#c8d0e0' }}>{park.emoji} {park.name}</div>
        <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>{openCount > 0 ? `${openCount} rides open` : 'Data unavailable'}</div>
      </div>
      {openCount > 0 && (
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color, fontFamily: 'monospace' }}>{avgWait}m</div>
          <div style={{ fontSize: '9px', color: '#475569', letterSpacing: '1px' }}>AVG WAIT</div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState<Tab>('decide')

  // Priorities — loaded from localStorage, shared across all tabs
  const [priorities, setPriorities] = useState<AllPriorities>({})

  // Settings tab — cached ride lists per park for the checklist
  const [settingsLoading, setSettingsLoading]     = useState<number | null>(null)
  const [settingsRides, setSettingsRides]         = useState<Record<number, Ride[]>>({})
  const [settingsOpenPark, setSettingsOpenPark]   = useState<number | null>(null)

  // Decide tab
  const [deciding, setDeciding]         = useState(false)
  const [decideResult, setDecideResult] = useState<DecideResult | null>(null)
  const [decideError, setDecideError]   = useState('')

  // Intel tab
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  const [rides, setRides]               = useState<Ride[]>([])
  const [loading, setLoading]           = useState(false)
  const [aiLoading, setAiLoading]       = useState(false)
  const [aiText, setAiText]             = useState('')
  const [error, setError]               = useState('')
  const [lastRefresh, setLastRefresh]   = useState<Date | null>(null)
  const [sortBy, setSortBy]             = useState<'wait' | 'name' | 'priority'>('priority')
  const [showClosed, setShowClosed]     = useState(false)
  const [currentTime, setCurrentTime]   = useState(getETTime())

  // Load priorities from localStorage on mount
  useEffect(() => { setPriorities(loadPriorities()) }, [])

  // Tick clock
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(getETTime()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Auto-refresh intel tab
  useEffect(() => {
    if (!selectedPark) return
    const t = setInterval(() => fetchWaits(selectedPark.id), 5 * 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPark])

  // ─── Priority helpers ────────────────────────────────────────────────────

  const updatePriorities = (next: AllPriorities) => {
    setPriorities(next)
    savePriorities(next)
  }

  const handleTogglePriority = (parkId: number, rideId: number) => {
    updatePriorities(togglePriority(priorities, parkId, rideId))
  }

  const handleToggleDone = (parkId: number, rideId: number) => {
    updatePriorities(toggleDone(priorities, parkId, rideId))
  }

  // Build a name map for a given set of rides (rideId → name)
  const rideNameMap = (rideList: Ride[]): Record<number, string> =>
    Object.fromEntries(rideList.map((r) => [r.id, r.name]))

  // Build cross-park priority context string for the decide endpoint
  const buildDecidePriorityContext = (): string => {
    const lines: string[] = []
    for (const park of PARKS) {
      const pp = priorities[park.id] ?? {}
      const cached = settingsRides[park.id] ?? []
      const names = rideNameMap(cached)
      const { priorityContext, hasPriorities } = summarisePriorities(park.id, priorities, names)
      if (hasPriorities) lines.push(`${park.name}:\n  ${priorityContext}`)
    }
    return lines.join('\n\n')
  }

  // ─── Settings: fetch ride list for a park ────────────────────────────────

  const fetchSettingsRides = async (parkId: number) => {
    if (settingsRides[parkId]) {
      // Already cached — just toggle accordion
      setSettingsOpenPark(prev => prev === parkId ? null : parkId)
      return
    }
    setSettingsLoading(parkId)
    try {
      const res = await fetch(`/api/waits?parkId=${parkId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSettingsRides(prev => ({ ...prev, [parkId]: data.rides }))
      setSettingsOpenPark(parkId)
    } catch {
      // silently fail — show empty
    } finally {
      setSettingsLoading(null)
    }
  }

  // ─── Decide ──────────────────────────────────────────────────────────────

  const handleDecide = async () => {
    setDeciding(true)
    setDecideError('')
    setDecideResult(null)
    try {
      const priorityContext = buildDecidePriorityContext()
      const res = await fetch('/api/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priorityContext }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      setDecideResult(data)
    } catch (e) {
      setDecideError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setDeciding(false)
    }
  }

  // ─── Intel: fetch single park ────────────────────────────────────────────

  const fetchWaits = useCallback(async (parkId: number) => {
    setLoading(true)
    setError('')
    setAiText('')
    try {
      const res = await fetch(`/api/waits?parkId=${parkId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      setRides(data.rides)
      setLastRefresh(new Date())
      // Also cache into settingsRides so Settings tab benefits
      setSettingsRides(prev => ({ ...prev, [parkId]: data.rides }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wait times')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleParkSelect = (park: Park) => {
    setSelectedPark(park)
    setRides([])
    setAiText('')
    setError('')
    setSortBy('priority')
    fetchWaits(park.id)
  }

  const handleAskAI = async () => {
    if (!selectedPark || !rides.length) return
    setAiLoading(true)
    setAiText('')
    try {
      const names = rideNameMap(rides)
      const { priorityContext } = summarisePriorities(selectedPark.id, priorities, names)
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parkName: selectedPark.name,
          rides,
          currentTimeET: currentTime,
          priorityContext,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'AI request failed')
      setAiText(data.recommendation)
    } catch (e) {
      setAiText(`⚠️ ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setAiLoading(false)
    }
  }

  // ─── Derived ────────────────────────────────────────────────────────────

  const openRides = rides.filter((r) => r.is_open)
  const openCount = openRides.length
  const avgWait   = openCount > 0 ? Math.round(openRides.reduce((s, r) => s + r.wait_time, 0) / openCount) : 0

  const parkPriorities = selectedPark ? (priorities[selectedPark.id] ?? {}) : {}

  const priorityCount = selectedPark
    ? Object.values(priorities[selectedPark.id] ?? {}).filter(s => s.priority && !s.done).length
    : 0

  const displayRides = rides
    .filter((r) => showClosed || r.is_open)
    .sort((a, b) => {
      const aState = parkPriorities[a.id] ?? { priority: false, done: false }
      const bState = parkPriorities[b.id] ?? { priority: false, done: false }
      if (sortBy === 'priority') {
        // Done rides always sink to bottom
        if (aState.done !== bState.done) return aState.done ? 1 : -1
        // Priority rides float to top
        if (aState.priority !== bState.priority) return aState.priority ? -1 : 1
        // Within same tier: open first, then by wait time
        return (Number(b.is_open) - Number(a.is_open)) || (a.wait_time - b.wait_time)
      }
      if (sortBy === 'wait') return (Number(b.is_open) - Number(a.is_open)) || (a.wait_time - b.wait_time)
      return a.name.localeCompare(b.name)
    })

  const disneyParks    = PARKS.filter((p) => p.resort === 'Disney')
  const universalParks = PARKS.filter((p) => p.resort === 'Universal')

  // Total priority ride count across all parks for settings badge
  const totalPriorityCount = Object.values(priorities).reduce((total, pp) => {
    return total + Object.values(pp).filter(s => s.priority && !s.done).length
  }, 0)

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <main style={{
      minHeight: '100vh', background: '#080c14',
      fontFamily: 'var(--font-dm-mono), "Courier New", monospace',
      color: '#e2e8f0', maxWidth: '480px', margin: '0 auto', paddingBottom: '40px',
    }}>

      {/* ── Header ── */}
      <header style={{
        background: 'linear-gradient(180deg, #0d1117 0%, #080c14 100%)',
        borderBottom: '1px solid #1e293b', padding: '14px 20px',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
            PARK<span style={{ color: '#00ff88' }}>INTEL</span>
          </div>
          <div style={{ background: '#0f1923', border: '1px solid #1e293b', borderRadius: '8px', padding: '4px 10px', fontSize: '12px', color: '#64748b' }}>
            🕐 {currentTime} ET
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {([
            { id: 'decide',   label: '🏆 Where Today?', sub: 'AI picks the best park' },
            { id: 'intel',    label: '📊 Park Intel',    sub: 'Deep dive one park' },
            { id: 'settings', label: '⭐ Priorities',    sub: totalPriorityCount > 0 ? `${totalPriorityCount} set` : 'Set must-dos' },
          ] as const).map(({ id, label, sub }) => (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: 1, padding: '7px 4px',
              background: tab === id ? '#00ff8818' : 'transparent',
              border: `1px solid ${tab === id ? '#00ff8855' : '#1e293b'}`,
              borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
              color: tab === id ? '#00ff88' : '#475569', transition: 'all 0.15s',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: '9px', marginTop: '2px', opacity: 0.7 }}>{sub}</div>
            </button>
          ))}
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════
          TAB: WHERE TODAY?
      ══════════════════════════════════════════════════════════════ */}
      {tab === 'decide' && (
        <section style={{ padding: '20px' }}>
          <div style={lbl}>Right Now Intelligence</div>

          <div style={{ background: '#0d1520', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', marginBottom: '20px', fontSize: '13px', color: '#64748b', lineHeight: 1.7 }}>
            Pulls live data from <strong style={{ color: '#94a3b8' }}>all 7 parks simultaneously</strong> and picks the best one for your group right now.
            {totalPriorityCount > 0 && (
              <span style={{ color: '#ffd700' }}> Your <strong>{totalPriorityCount} priority ride{totalPriorityCount !== 1 ? 's' : ''}</strong> are factored into the decision.</span>
            )}
          </div>

          <button onClick={handleDecide} disabled={deciding} style={{
            width: '100%', padding: '18px',
            background: deciding ? '#0d1520' : 'linear-gradient(135deg, #00ff8825, #0ea5e925)',
            border: `2px solid ${deciding ? '#1e293b' : '#00ff88'}`,
            borderRadius: '14px', color: deciding ? '#475569' : '#00ff88',
            fontSize: '15px', fontWeight: 800, cursor: deciding ? 'not-allowed' : 'pointer',
            letterSpacing: '0.5px', fontFamily: 'inherit', marginBottom: '20px', transition: 'all 0.2s',
          }}>
            {deciding ? '⟳  Scanning all 7 parks...' : '🏆  WHERE SHOULD WE GO?'}
          </button>

          {deciding && (
            <div style={{ marginBottom: '16px' }}>
              <div style={lbl}>Fetching live data...</div>
              {PARKS.map((p) => (
                <div key={p.id} style={{ background: '#0d1520', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px 14px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>{p.emoji}</span>
                  <span style={{ fontSize: '12px', color: '#334155' }}>{p.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#1e3a2e' }}>loading...</span>
                </div>
              ))}
            </div>
          )}

          {decideError && (
            <div style={{ background: '#ff336611', border: '1px solid #ff336633', borderRadius: '12px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ color: '#ff3366', fontSize: '13px' }}>⚠️ {decideError}</div>
            </div>
          )}

          {decideResult && !deciding && (
            <>
              <div style={lbl}>Live Snapshot — All Parks</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
                {[...decideResult.parkDetails]
                  .sort((a, b) => { if (a.avgWait === 0) return 1; if (b.avgWait === 0) return -1; return a.avgWait - b.avgWait })
                  .map((d) => <SnapshotCard key={d.park.id} detail={d} />)}
              </div>

              <div style={lbl}>AI Verdict</div>
              <DecideResponse text={decideResult.recommendation} />

              <div style={{ fontSize: '10px', color: '#1e293b', textAlign: 'center', marginTop: '14px' }}>
                Fetched {new Date(decideResult.fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' })} ET
              </div>

              <button onClick={handleDecide} style={{ width: '100%', padding: '12px', background: 'transparent', border: '1px solid #1e293b', borderRadius: '10px', color: '#475569', fontSize: '12px', cursor: 'pointer', marginTop: '14px', fontFamily: 'inherit' }}>
                ↻ Re-scan All Parks
              </button>
            </>
          )}

          {!decideResult && !deciding && !decideError && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#1e293b' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎯</div>
              <div style={{ fontSize: '12px', lineHeight: 1.7 }}>Tap the button when you're at the villa deciding where to go. Takes ~10 seconds.</div>
            </div>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: PARK INTEL
      ══════════════════════════════════════════════════════════════ */}
      {tab === 'intel' && (
        <>
          <section style={{ padding: '20px' }}>
            <div style={lbl}>Select Park</div>
            {[
              { group: 'Walt Disney World', parks: disneyParks },
              { group: 'Universal Orlando',  parks: universalParks },
            ].map(({ group, parks }) => (
              <div key={group} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '9px', color: '#334155', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '8px' }}>{group}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {parks.map((park) => {
                    const active = selectedPark?.id === park.id
                    const pc = Object.values(priorities[park.id] ?? {}).filter(s => s.priority && !s.done).length
                    return (
                      <button key={park.id} onClick={() => handleParkSelect(park)} style={{
                        background: active ? '#00ff8820' : '#0d1520',
                        border: `1px solid ${active ? '#00ff88' : '#1e293b'}`,
                        borderRadius: '12px', padding: '14px 10px', cursor: 'pointer',
                        textAlign: 'left', color: active ? '#00ff88' : '#94a3b8',
                        fontFamily: 'inherit', transition: 'all 0.15s', position: 'relative',
                      }}>
                        {pc > 0 && (
                          <span style={{ position: 'absolute', top: '8px', right: '8px', background: '#ffd700', color: '#000', fontSize: '9px', fontWeight: 800, borderRadius: '10px', padding: '1px 6px' }}>
                            ⭐{pc}
                          </span>
                        )}
                        <span style={{ fontSize: '22px', display: 'block', marginBottom: '6px' }}>{park.emoji}</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, lineHeight: 1.3 }}>{park.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </section>

          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569' }}>
              <div style={{ fontSize: '28px', marginBottom: '12px' }}>⟳</div>
              <div style={{ fontSize: '13px' }}>Fetching live wait times...</div>
            </div>
          )}

          {error && !loading && (
            <div style={{ margin: '0 20px', background: '#ff336611', border: '1px solid #ff336633', borderRadius: '12px', padding: '16px' }}>
              <div style={{ color: '#ff3366', fontSize: '13px' }}>⚠️ {error}</div>
            </div>
          )}

          {!loading && rides.length > 0 && selectedPark && (
            <section style={{ padding: '0 20px' }}>
              {/* Stats */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                {[
                  { val: openCount,   label: 'Open',     color: '#00ff88' },
                  { val: `${avgWait}m`, label: 'Avg Wait', color: '#ffd700' },
                  { val: priorityCount > 0 ? `⭐${priorityCount}` : rides.length - openCount, label: priorityCount > 0 ? 'Priority' : 'Closed', color: priorityCount > 0 ? '#ffd700' : '#60a5fa' },
                ].map(({ val, label, color }) => (
                  <div key={label} style={{ flex: 1, background: '#0d1520', border: `1px solid ${color}33`, borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '22px', fontWeight: 800, color, fontFamily: 'monospace' }}>{val}</div>
                    <div style={{ fontSize: '9px', color: '#475569', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '2px' }}>{label}</div>
                  </div>
                ))}
              </div>

              {lastRefresh && (
                <div style={{ fontSize: '10px', color: '#334155', textAlign: 'center', marginBottom: '12px' }}>
                  Updated {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refreshes every 5 min
                </div>
              )}

              {/* AI brief */}
              <div style={lbl}>AI Tactical Analysis</div>
              <button onClick={handleAskAI} disabled={aiLoading} style={{
                width: '100%', padding: '16px',
                background: aiLoading ? '#0d1520' : 'linear-gradient(135deg, #00ff8830, #00cc6630)',
                border: `1px solid ${aiLoading ? '#1e293b' : '#00ff88'}`,
                borderRadius: '12px', color: aiLoading ? '#475569' : '#00ff88',
                fontSize: '14px', fontWeight: 800, cursor: aiLoading ? 'not-allowed' : 'pointer',
                letterSpacing: '1px', marginBottom: '16px', fontFamily: 'inherit',
              }}>
                {aiLoading ? '⟳  ANALYSING...' : '⚡  GET AI TACTICAL BRIEF'}
              </button>

              {aiText && <div style={{ marginBottom: '20px' }}><AIResponse text={aiText} /></div>}

              {/* Ride list */}
              <div style={lbl}>Live Wait Times</div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                {(['priority', 'wait', 'name'] as const).map((s) => (
                  <button key={s} onClick={() => setSortBy(s)} style={{
                    background: sortBy === s ? '#1e293b' : 'transparent',
                    border: `1px solid ${sortBy === s ? '#334155' : '#1e293b'}`,
                    borderRadius: '8px', padding: '6px 10px', cursor: 'pointer',
                    color: sortBy === s ? '#e2e8f0' : '#475569',
                    fontSize: '11px', fontWeight: 600, fontFamily: 'inherit',
                  }}>
                    {s === 'priority' ? '⭐ Priority' : s === 'wait' ? '⏱ Wait' : 'A–Z'}
                  </button>
                ))}
                <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#475569', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} style={{ accentColor: '#00ff88' }} />
                  Closed
                </label>
              </div>

              {displayRides.map((ride) => {
                const rState = parkPriorities[ride.id] ?? { priority: false, done: false }
                return (
                  <div key={ride.id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', marginBottom: '6px',
                    background: rState.done ? '#060a10' : rState.priority ? '#0d1a0d' : ride.is_open ? '#0d1520' : '#090d14',
                    border: `1px solid ${rState.priority && !rState.done ? '#ffd70040' : rState.done ? '#0d1117' : ride.is_open ? '#1e293b' : '#111827'}`,
                    borderRadius: '10px', opacity: rState.done ? 0.4 : ride.is_open ? 1 : 0.5,
                  }}>
                    {/* Priority star toggle */}
                    <button
                      onClick={() => handleTogglePriority(selectedPark.id, ride.id)}
                      title={rState.priority ? 'Remove priority' : 'Mark as priority'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '0', lineHeight: 1, flexShrink: 0 }}
                    >
                      {rState.priority ? '⭐' : '☆'}
                    </button>

                    {/* Ride info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13px', fontWeight: 600, color: '#c8d0e0',
                        textDecoration: rState.done ? 'line-through' : 'none',
                        }}>
                        {ride.name}
                      </div>
                      <div style={{ fontSize: '10px', color: '#334155', marginTop: '2px' }}>{ride.land}</div>
                    </div>

                    {/* Done checkbox */}
                    <button
                      onClick={() => handleToggleDone(selectedPark.id, ride.id)}
                      title={rState.done ? 'Mark as not done' : 'Mark as done'}
                      style={{
                        background: rState.done ? '#00ff8830' : 'transparent',
                        border: `1px solid ${rState.done ? '#00ff8866' : '#1e293b'}`,
                        borderRadius: '6px', padding: '3px 8px', cursor: 'pointer',
                        color: rState.done ? '#00ff88' : '#334155',
                        fontSize: '10px', fontWeight: 700, fontFamily: 'inherit', flexShrink: 0,
                      }}
                    >
                      {rState.done ? '✓ Done' : 'Done'}
                    </button>

                    <WaitBadge minutes={ride.wait_time} isOpen={ride.is_open} />
                  </div>
                )
              })}

              <button onClick={() => fetchWaits(selectedPark.id)} style={{ width: '100%', padding: '12px', background: 'transparent', border: '1px solid #1e293b', borderRadius: '10px', color: '#475569', fontSize: '12px', cursor: 'pointer', marginTop: '12px', fontFamily: 'inherit' }}>
                ↻ Refresh Now
              </button>
            </section>
          )}

          {!loading && !error && rides.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#334155' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎢</div>
              <div style={{ fontSize: '13px' }}>Select a park above to load live wait times</div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: SETTINGS / PRIORITIES
      ══════════════════════════════════════════════════════════════ */}
      {tab === 'settings' && (
        <section style={{ padding: '20px' }}>
          <div style={lbl}>Priority Rides</div>

          <div style={{ background: '#0d1520', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px 16px', marginBottom: '20px', fontSize: '12px', color: '#64748b', lineHeight: 1.7 }}>
            Set up your must-do rides before the trip. ⭐ marks a ride as priority. ✓ Done marks it as completed.
            Priorities are saved to this device and fed into every AI recommendation automatically.
          </div>

          {[
            { group: 'Walt Disney World', parks: disneyParks },
            { group: 'Universal Orlando',  parks: universalParks },
          ].map(({ group, parks }) => (
            <div key={group} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '9px', color: '#334155', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' }}>{group}</div>

              {parks.map((park) => {
                const isOpen = settingsOpenPark === park.id
                const isLoading = settingsLoading === park.id
                const parkRides = settingsRides[park.id] ?? []
                const pp = priorities[park.id] ?? {}
                const priorityCount = Object.values(pp).filter(s => s.priority && !s.done).length
                const doneCount     = Object.values(pp).filter(s => s.done).length

                return (
                  <div key={park.id} style={{ marginBottom: '8px' }}>
                    {/* Park accordion header */}
                    <button
                      onClick={() => fetchSettingsRides(park.id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                        background: isOpen ? '#0d1a20' : '#0d1520',
                        border: `1px solid ${isOpen ? '#00ff8840' : '#1e293b'}`,
                        borderRadius: isOpen ? '12px 12px 0 0' : '12px',
                        padding: '14px 16px', cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'all 0.15s',
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>{park.emoji}</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#c8d0e0', flex: 1, textAlign: 'left' }}>{park.name}</span>
                      {priorityCount > 0 && (
                        <span style={{ background: '#ffd70020', border: '1px solid #ffd70040', color: '#ffd700', fontSize: '10px', fontWeight: 700, borderRadius: '10px', padding: '2px 8px' }}>
                          ⭐ {priorityCount}
                        </span>
                      )}
                      {doneCount > 0 && (
                        <span style={{ background: '#00ff8815', border: '1px solid #00ff8830', color: '#00ff88', fontSize: '10px', fontWeight: 700, borderRadius: '10px', padding: '2px 8px' }}>
                          ✓ {doneCount}
                        </span>
                      )}
                      <span style={{ color: '#334155', fontSize: '12px' }}>{isLoading ? '⟳' : isOpen ? '▲' : '▼'}</span>
                    </button>

                    {/* Ride checklist */}
                    {isOpen && parkRides.length > 0 && (
                      <div style={{ background: '#080e18', border: '1px solid #1e293b', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
                        {parkRides
                          .filter(r => r.is_open || (pp[r.id]?.priority))
                          .sort((a, b) => {
                            const ap = pp[a.id] ?? { priority: false, done: false }
                            const bp = pp[b.id] ?? { priority: false, done: false }
                            if (ap.done !== bp.done) return ap.done ? 1 : -1
                            if (ap.priority !== bp.priority) return ap.priority ? -1 : 1
                            return a.name.localeCompare(b.name)
                          })
                          .map((ride, idx, arr) => {
                            const rState = pp[ride.id] ?? { priority: false, done: false }
                            return (
                              <div key={ride.id} style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '11px 16px',
                                borderBottom: idx < arr.length - 1 ? '1px solid #0f1923' : 'none',
                                background: rState.priority && !rState.done ? '#0d1a0d' : 'transparent',
                                opacity: rState.done ? 0.4 : 1,
                              }}>
                                {/* Priority toggle */}
                                <button
                                  onClick={() => handleTogglePriority(park.id, ride.id)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: 0, lineHeight: 1, flexShrink: 0 }}
                                >
                                  {rState.priority ? '⭐' : '☆'}
                                </button>

                                {/* Name */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontSize: '13px', color: '#c8d0e0', fontWeight: rState.priority ? 700 : 400,
                                    textDecoration: rState.done ? 'line-through' : 'none',
                                    }}>
                                    {ride.name}
                                  </div>
                                  <div style={{ fontSize: '10px', color: '#334155', marginTop: '1px' }}>{ride.land}</div>
                                </div>

                                {/* Done toggle */}
                                <button
                                  onClick={() => handleToggleDone(park.id, ride.id)}
                                  style={{
                                    background: rState.done ? '#00ff8825' : 'transparent',
                                    border: `1px solid ${rState.done ? '#00ff8850' : '#1e293b'}`,
                                    borderRadius: '6px', padding: '3px 10px',
                                    color: rState.done ? '#00ff88' : '#334155',
                                    fontSize: '10px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {rState.done ? '✓' : 'Done'}
                                </button>
                              </div>
                            )
                          })}

                        {/* Closed rides not yet prioritised — collapsed hint */}
                        {(() => {
                          const closedUnset = parkRides.filter(r => !r.is_open && !pp[r.id]?.priority)
                          return closedUnset.length > 0 ? (
                            <div style={{ padding: '8px 16px', fontSize: '10px', color: '#1e293b', borderTop: '1px solid #0f1923' }}>
                              + {closedUnset.length} closed ride{closedUnset.length !== 1 ? 's' : ''} hidden (not currently operating)
                            </div>
                          ) : null
                        })()}
                      </div>
                    )}

                    {isOpen && parkRides.length === 0 && !isLoading && (
                      <div style={{ background: '#080e18', border: '1px solid #1e293b', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '14px 16px', fontSize: '12px', color: '#334155' }}>
                        No ride data available — try again later.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}

          {/* Clear all button */}
          {totalPriorityCount > 0 && (
            <button
              onClick={() => { updatePriorities({}); }}
              style={{ width: '100%', padding: '12px', background: 'transparent', border: '1px solid #ff336633', borderRadius: '10px', color: '#ff3366', fontSize: '12px', cursor: 'pointer', marginTop: '16px', fontFamily: 'inherit' }}
            >
              🗑 Clear all priorities & done markers
            </button>
          )}
        </section>
      )}

      <div style={{ textAlign: 'center', padding: '20px 20px 0', fontSize: '10px', color: '#1e293b' }}>
        Powered by{' '}
        <a href="https://queue-times.com" target="_blank" rel="noreferrer" style={{ color: '#334155', textDecoration: 'none' }}>
          Queue-Times.com
        </a>
      </div>
    </main>
  )
}

const lbl: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, color: '#475569',
  letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px',
}
