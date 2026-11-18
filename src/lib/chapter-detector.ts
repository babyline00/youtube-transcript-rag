/**
 * Auto chapter detection.
 *
 * Walks the chunk list and splits it into chapters at either:
 *   (a) a gap > 30 seconds between the end of one chunk and the start of the
 *       next (silence / pause in the transcript), OR
 *   (b) cosine distance > 0.6 between adjacent chunk embeddings (semantic
 *       topic shift).
 *
 * Distance is `1 - cosine_sim`, so `distance > 0.6` means cosine < 0.4 — a
 * strong topic change for hashing-trick embeddings on small chunks.
 *
 * After boundaries are detected, titles are generated for each chapter in
 * ONE batched LLM call. If the LLM call fails (or is disabled), we fall back
 * to the heuristic "first 6 words of the chapter's first chunk" — cheap,
 * deterministic, and useful enough for navigation.
 */

import type { CaptionChunk } from './chunker'
import { cosine } from './embeddings'

export interface ChapterBoundary {
  /** Index into the chunks array where the chapter starts (inclusive). */
  startIdx: number
  /** Index where the chapter ends (exclusive — same as next chapter's start). */
  endIdx: number
  /** Optional title (filled in later). */
  title?: string
}

export const DEFAULT_GAP_THRESHOLD_SEC = 30
export const DEFAULT_DISTANCE_THRESHOLD = 0.6

export function detectChapterBoundaries(
  chunks: CaptionChunk[],
  vectors: Float32Array[],
  opts: {
    gapThresholdSec?: number
    distanceThreshold?: number
  } = {},
): ChapterBoundary[] {
  const gapThreshold = opts.gapThresholdSec ?? DEFAULT_GAP_THRESHOLD_SEC
  const distanceThreshold = opts.distanceThreshold ?? DEFAULT_DISTANCE_THRESHOLD

  if (chunks.length === 0) return []
  if (vectors.length !== chunks.length) {
    throw new Error(`chunks.length (${chunks.length}) must equal vectors.length (${vectors.length})`)
  }

  const boundaries: ChapterBoundary[] = [{ startIdx: 0, endIdx: chunks.length }]

  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]
    const curr = chunks[i]
    const gap = curr.startSec - prev.endSec
    const dist = 1 - cosine(vectors[i - 1], vectors[i])
    if (gap > gapThreshold || dist > distanceThreshold) {
      const last = boundaries[boundaries.length - 1]
      last.endIdx = i
      boundaries.push({ startIdx: i, endIdx: chunks.length })
    }
  }

  return boundaries
}

/**
 * Heuristic fallback title: first N words of the chapter's first chunk.
 *
 * The LLM-titled path is implemented in the import route (one batched call for
 * all chapter seeds); this function gives us a deterministic title when the
 * LLM is unavailable or the call fails.
 */
export function heuristicChapterTitle(chunks: CaptionChunk[], boundary: ChapterBoundary, wordCount = 6): string {
  const firstChunk = chunks[boundary.startIdx]
  if (!firstChunk || !firstChunk.content) return `Chapter ${boundary.startIdx + 1}`
  const words = firstChunk.content.split(/\s+/).filter(Boolean).slice(0, wordCount).join(' ')
  return words || `Chapter ${boundary.startIdx + 1}`
}

export interface ChapterSeed {
  startSec: number
  endSec: number
  seedText: string
  ordinal: number
}

/** Build the seeds to send to the LLM for batched titling. */
export function buildChapterSeeds(chunks: CaptionChunk[], boundaries: ChapterBoundary[]): ChapterSeed[] {
  return boundaries.map((b, i) => {
    const first = chunks[b.startIdx]
    const last = chunks[Math.max(0, b.endIdx - 1)]
    return {
      ordinal: i + 1,
      startSec: first.startSec,
      endSec: (last?.endSec ?? first.endSec),
      seedText: chunks
        .slice(b.startIdx, Math.min(b.endIdx, b.startIdx + 3))
        .map((c) => c.content)
        .filter(Boolean)
        .join(' ')
        .slice(0, 240),
    }
  })
}

/**
 * Parse the LLM's batched response (one title per line, prefixed by ordinal
 * `N. `) back into a stable list of titles keyed by ordinal. Falls back to the
 * heuristic when a line is missing or malformed.
 */
export function parseChapterTitles(
  response: string,
  seeds: ChapterSeed[],
): string[] {
  const titles = new Array(seeds.length).fill('')

  // Parse `N. Title` lines from the response (when present).
  if (response) {
    const lines = response.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const line of lines) {
      const m = line.match(/^(\d+)[.)]\s*(.+)$/)
      if (!m) continue
      const idx = parseInt(m[1], 10) - 1
      if (idx < 0 || idx >= seeds.length) continue
      titles[idx] = m[2].trim().slice(0, 80)
    }
  }

  // Fill any gaps (missing lines, or empty response) with heuristic titles
  // derived from the first 6 words of the chapter's seed text. Falls back to
  // "Chapter N" only when the seed text is also empty.
  for (let i = 0; i < titles.length; i++) {
    if (!titles[i]) {
      const words = (seeds[i].seedText || '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
      titles[i] = words || `Chapter ${i + 1}`
    }
  }
  return titles
}
