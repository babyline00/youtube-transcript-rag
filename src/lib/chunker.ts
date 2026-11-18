/**
 * Timestamp-anchored caption chunker.
 *
 * YouTube transcripts come back as a list of `{ text, offset, durationMs }`
 * caption segments from the `youtube-transcript` package. This chunker walks
 * the caption stream and emits 30-second windows with a 5-second overlap so
 * retrieval can match across boundaries without losing context.
 *
 * Each chunk carries its absolute `startSec` / `endSec` so citations can jump
 * the embedded player to that moment via postMessage('seekTo', ...).
 */

export interface CaptionCue {
  /** Caption text. */
  text: string
  /** Start offset in milliseconds. */
  offsetMs: number
  /** Duration in milliseconds. */
  durationMs: number
}

export interface CaptionChunk {
  /** 1-indexed position within the video. */
  ordinal: number
  /** Absolute start second (inclusive). */
  startSec: number
  /** Absolute end second (exclusive). */
  endSec: number
  /** Concatenated caption text for this window. */
  content: string
}

export const DEFAULT_WINDOW_SEC = 30
export const DEFAULT_OVERLAP_SEC = 5

/**
 * Walk a list of caption cues and emit chunks covering fixed-length windows.
 *
 * Algorithm:
 *   - Start the first window at cue[0].offsetMs.
 *   - Collect every cue whose midpoint falls inside [windowStart, windowStart + window).
 *   - Emit the chunk at windowStart + window.
 *   - The next window starts at windowStart + (window - overlap) so the last
 *     5 seconds of cues bleed into the next chunk (overlap).
 *
 * Midpoint-inclusion is the right call here because a cue straddling a window
 * boundary would otherwise be duplicated; we want each cue assigned to the
 * window whose centre it overlaps. We still duplicate cues that fall fully
 * inside the overlap region — that's intentional, it's the whole point of
 * the overlap.
 *
 * `startSec` is always `floor(windowStartMs / 1000)` (rounded DOWN) and
 * `endSec` is `floor((windowStartMs + windowMs - 1) / 1000) + 1` (rounded UP),
 * so timestamps form a clean monotonic sequence covering every second of
 * the video.
 */
export function chunkCaptions(
  cues: CaptionCue[],
  opts: { windowSec?: number; overlapSec?: number } = {},
): CaptionChunk[] {
  const windowSec = opts.windowSec ?? DEFAULT_WINDOW_SEC
  const overlapSec = opts.overlapSec ?? DEFAULT_OVERLAP_SEC
  if (windowSec <= 0) throw new Error('windowSec must be positive')
  if (overlapSec < 0) throw new Error('overlapSec must be >= 0')
  if (overlapSec >= windowSec) throw new Error('overlapSec must be < windowSec')

  if (!cues.length) return []

  // Sort by offset (defensive — youtube-transcript usually returns sorted).
  const sorted = [...cues].sort((a, b) => a.offsetMs - b.offsetMs)
  const lastCueEnd = sorted[sorted.length - 1].offsetMs + sorted[sorted.length - 1].durationMs
  const totalMs = Math.max(lastCueEnd, sorted[sorted.length - 1].offsetMs + 1000)

  const windowMs = windowSec * 1000
  const stepMs = (windowSec - overlapSec) * 1000

  const chunks: CaptionChunk[] = []
  let windowStart = sorted[0].offsetMs
  let ordinal = 0

  while (windowStart < totalMs) {
    const windowEnd = windowStart + windowMs
    // Cues whose midpoint falls inside this window.
    const windowCues = sorted.filter((c) => {
      const mid = c.offsetMs + c.durationMs / 2
      return mid >= windowStart && mid < windowEnd
    })

    // If we have no cues in this window (a long silence), skip forward to the
    // next cue instead of emitting an empty chunk — UNLESS this is the very
    // first window, in which case we still want to anchor chunk 1 at second 0.
    if (windowCues.length === 0 && chunks.length > 0) {
      const nextCue = sorted.find((c) => c.offsetMs >= windowEnd)
      if (!nextCue) break
      windowStart = nextCue.offsetMs
      continue
    }

    ordinal += 1
    const content = windowCues
      .map((c) => c.text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
      .trim()

    if (content.length === 0 && chunks.length > 0) {
      // No text content in this window — skip but advance.
      windowStart += stepMs
      continue
    }

    const startSec = Math.floor(windowStart / 1000)
    const endSec = Math.max(startSec + 1, Math.ceil(windowEnd / 1000))

    chunks.push({ ordinal, startSec, endSec, content })

    windowStart += stepMs
  }

  return chunks
}

/**
 * Estimate "tokens" for a chunk — same char/4 heuristic as the notes project.
 * Used by BM25 / vector layers but never persisted as the source of truth
 * (tokens themselves are persisted as a JSON string column).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}
