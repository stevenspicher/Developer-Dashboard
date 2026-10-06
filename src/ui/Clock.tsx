import { useEffect, useState } from 'react'

// The time and date. It ticks on its own so the rest of the page doesn't
// re-render every second.
export function Clock({ showDate = true }: { showDate?: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="text-right">
      <div className="font-mono text-stat leading-none text-ink">{now.toLocaleTimeString('en-US', { hour12: false })}</div>
      {showDate && (
        <div className="mt-0.5 font-mono text-meta text-muted">
          {now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
        </div>
      )}
    </div>
  )
}
