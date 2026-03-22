'use client'

interface Props {
  minutes: number
  isOpen: boolean
}

export function WaitBadge({ minutes, isOpen }: Props) {
  if (!isOpen) {
    return (
      <span style={{
        background: '#1a1a2e', color: '#4a4a6a', padding: '4px 10px',
        borderRadius: '20px', fontSize: '13px', fontFamily: 'monospace', fontWeight: 700,
      }}>
        CLOSED
      </span>
    )
  }

  const color =
    minutes <= 15 ? '#00ff88' :
    minutes <= 35 ? '#ffd700' :
    minutes <= 60 ? '#ff8c00' : '#ff3366'

  return (
    <span style={{
      background: color + '22', color, border: `1px solid ${color}66`,
      padding: '4px 12px', borderRadius: '20px', fontSize: '14px',
      fontFamily: 'monospace', fontWeight: 800, letterSpacing: '0.5px',
    }}>
      {minutes}m
    </span>
  )
}
