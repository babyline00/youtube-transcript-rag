/**
 * YouTube URL parser.
 *
 * Accepts every common YouTube URL shape:
 *   - https://www.youtube.com/watch?v=ID
 *   - https://youtu.be/ID
 *   - https://www.youtube.com/embed/ID
 *   - https://www.youtube.com/shorts/ID
 *   - https://www.youtube.com/live/ID
 *   - https://m.youtube.com/watch?v=ID
 *
 * Extracts the 11-char video id and the optional `t=` / `start=` time offset
 * (in seconds). Rejects non-YouTube hosts and malformed ids.
 */

export interface ParsedYouTubeUrl {
  videoId: string
  startSec?: number
  /** Original raw URL for display. */
  raw: string
}

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

const ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * Parse a YouTube time parameter (`t=120`, `start=90`, `t=1m30s`, `t=1h2m3s`)
 * into seconds. Returns 0 when not present.
 */
export function parseTimeParam(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const v = decodeURIComponent(value)
  // ISO 8601-ish h/m/s form (1h2m3s, 90s, 1m30)
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

/**
 * Parse a YouTube URL.
 *
 * @returns `ParsedYouTubeUrl` on success.
 * @throws `Error` when the URL is not a recognised YouTube URL or the video id
 *   is malformed.
 */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl {
  if (!input || typeof input !== 'string') throw new Error('empty url')
  let url: URL
  try {
    // Allow bare IDs (e.g. "dQw4w9WgXcQ") to short-circuit.
    if (ID_RE.test(input.trim())) {
      return { videoId: input.trim(), raw: input }
    }
    // Allow scheme-less input like "youtu.be/ID".
    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`
    url = new URL(candidate)
  } catch {
    throw new Error(`invalid url: ${input}`)
  }

  const host = url.hostname.toLowerCase()
  if (!YT_HOSTS.has(host)) {
    throw new Error(`not a youtube url: ${host}`)
  }

  let videoId: string | undefined
  // youtu.be/<id>
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0]
  } else {
    const segments = url.pathname.split('/').filter(Boolean)
    // /watch?v=ID  -> handled below
    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    if (segments.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(segments[0])) {
      videoId = segments[1]
    } else if (segments.length >= 1 && ID_RE.test(segments[0])) {
      videoId = segments[0]
    }
  }

  if (!videoId) {
    const v = url.searchParams.get('v')
    if (v) videoId = v
  }

  if (!videoId || !ID_RE.test(videoId)) {
    throw new Error(`could not extract a valid 11-char video id from: ${input}`)
  }

  // Time offset: t= or start=
  const t = parseTimeParam(url.searchParams.get('t')) ?? parseTimeParam(url.searchParams.get('start'))

  return { videoId, startSec: t, raw: input }
}

/**
 * Type guard helper: returns null on failure instead of throwing. Useful for
 * UI form-validation where a thrown error would be noisy.
 */
export function tryParseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  try {
    return parseYouTubeUrl(input)
  } catch {
    return null
  }
}

/** Build a youtube-nocookie.com embed URL suitable for an iframe `src`. */
export function buildEmbedUrl(videoId: string, startSec?: number): string {
  const base = `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&rel=0`
  if (startSec != null && startSec > 0) return `${base}&start=${startSec}`
  return base
}

/** Build the canonical youtube.com thumbnail URL. */
export function buildThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}
