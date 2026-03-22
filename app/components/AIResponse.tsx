'use client'

const SECTIONS = [
  { key: '🟢 GO NOW',       color: '#00ff88', bg: '#00ff8811', border: '#00ff8833' },
  { key: '🔴 SKIP FOR NOW', color: '#ff3366', bg: '#ff336611', border: '#ff336633' },
  { key: '⚡ HIDDEN GEM',   color: '#ffd700', bg: '#ffd70011', border: '#ffd70033' },
  { key: '📊 CROWD VERDICT',color: '#60a5fa', bg: '#60a5fa11', border: '#60a5fa33' },
  { key: '🗺️ NEXT 2 HOURS', color: '#c084fc', bg: '#c084fc11', border: '#c084fc33' },
]

export function AIResponse({ text }: { text: string }) {
  const parsed: { title: string; content: string; color: string; bg: string; border: string }[] = []

  for (let i = 0; i < SECTIONS.length; i++) {
    const { key, ...styles } = SECTIONS[i]
    const nextKey = SECTIONS[i + 1]?.key
    const start = text.indexOf(key)
    if (start === -1) continue
    const end = nextKey ? text.indexOf(nextKey) : text.length
    const content = text.slice(start + key.length, end === -1 ? undefined : end).trim()
    parsed.push({ title: key, content, ...styles })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {parsed.map(({ title, content, color, bg, border }) => (
        <div key={title} style={{
          background: bg, border: `1px solid ${border}`,
          borderRadius: '12px', padding: '14px 16px', borderLeft: `3px solid ${color}`,
        }}>
          <div style={{ color, fontWeight: 800, fontSize: '13px', marginBottom: '8px', letterSpacing: '0.5px' }}>
            {title}
          </div>
          <div style={{ color: '#c8d0e0', fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {content}
          </div>
        </div>
      ))}
    </div>
  )
}
