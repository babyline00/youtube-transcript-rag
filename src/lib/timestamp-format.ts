/**
 * Timestamp formatting helpers for citation chips and chapter lists.
 *
 * Rules:
 *   - < 1 hour:  `m:ss`   (e.g. 3:07, 12:00, 59:59)
 *   - >= 1 hour: `h:mm:ss` (e.g. 1:02:03, 2:00:00)
 *   - negative or NaN -> "0:00"
 *
 * Kept as a pure module so tests cover every branch (including the >1hr edge
 * case which trips a lot of formatting code in the wild).
 */

export function formatTimestamp(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '0:00'
  const s = Math.floor(totalSec)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Format a chunk's [startSec, endSec) range as `m:ss - m:ss`. */
export function formatTimeRange(startSec: number, endSec: number): string {
  return `${formatTimestamp(startSec)} - ${formatTimestamp(endSec)}`
}

/**
 * Parse a YouTube `?t=` / `?start=` value into seconds. Accepts:
 *   - `120`        -> 120
 *   - `1m30s`      -> 90
 *   - `1h2m3s`     -> 3723
 *   - `90s`        -> 90
 *   - `01:30`      -> 90 (mm:ss)
 *   - `1:02:03`    -> 3723 (h:mm:ss)
 */
export function parseTimestamp(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
  const v = value.trim()
  if (!v) return undefined

  // Colon form: h:mm:ss or m:ss
  if (v.includes(':')) {
    const parts = v.split(':').map((p) => parseInt(p, 10))
    if (parts.some((p) => Number.isNaN(p))) return undefined
    let total = 0
    for (const p of parts) {
      total = total * 60 + p
    }
    return total >= 0 ? total : undefined
  }

  // h/m/s suffix form
  const hmsMatch = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i)
  if (hmsMatch) {
    const h = parseInt(hmsMatch[1] ?? '0', 10) || 0
    const m = parseInt(hmsMatch[2] ?? '0', 10) || 0
    const s = parseInt(hmsMatch[3] ?? '0', 10) || 0
    if (h === 0 && m === 0 && s === 0) return undefined
    return h * 3600 + m * 60 + s
  }
  const n = parseInt(v, 10)
  if (!Number.isNaN(n) && n >= 0) return n
  return undefined
}
