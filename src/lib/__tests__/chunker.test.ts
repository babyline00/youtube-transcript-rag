import { test, expect, describe } from 'bun:test'
import { chunkCaptions, estimateTokens, type CaptionCue } from '../chunker'

function cue(text: string, offsetMs: number, durationMs = 2000): CaptionCue {
  return { text, offsetMs, durationMs }
}

describe('chunkCaptions — basic behaviour', () => {
  test('empty input -> empty array', () => {
    expect(chunkCaptions([])).toEqual([])
  })
  test('single cue stays in one chunk', () => {
    const chunks = chunkCaptions([cue('hello', 0, 1000)])
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toBe('hello')
    expect(chunks[0].ordinal).toBe(1)
  })
  test('30s window of cues produces a chunk spanning the window', () => {
    // 25 cues at 1-second offsets fit cleanly inside a single 30s window
    // (step = 25s, so the second window would start at 25s and find no cues).
    const cues: CaptionCue[] = Array.from({ length: 25 }, (_, i) => cue(`line${i}`, i * 1000, 800))
    const chunks = chunkCaptions(cues)
    expect(chunks.length).toBe(1)
    expect(chunks[0].startSec).toBe(0)
    expect(chunks[0].endSec).toBeGreaterThanOrEqual(30)
  })
})

describe('chunkCaptions — 30s window + 5s overlap', () => {
  test('a 60-second video produces 2 chunks (30s + 5s overlap = 25s step)', () => {
    // 60 cues at 1-second offsets -> covers 0..60s.
    // Window is 30s, step is 25s -> chunk 0 covers [0,30), chunk 1 covers [25,55).
    const cues: CaptionCue[] = Array.from({ length: 60 }, (_, i) => cue(`line${i}`, i * 1000, 800))
    const chunks = chunkCaptions(cues)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].startSec).toBe(0)
    expect(chunks[1].startSec).toBe(25) // 30 - 5 overlap = 25s step
  })
  test('overlap region cues appear in BOTH chunks', () => {
    // 30s window + 5s overlap -> cues in [25,30) appear in both chunk 0 and chunk 1.
    const cues: CaptionCue[] = Array.from({ length: 60 }, (_, i) => cue(`line${i}`, i * 1000, 800))
    const chunks = chunkCaptions(cues)
    const c0 = chunks[0].content
    const c1 = chunks[1].content
    // line26, line27, line28, line29 (offsets 26..29s, midpoints fall in [25,30))
    expect(c0).toContain('line26')
    expect(c1).toContain('line26')
    expect(c0).toContain('line29')
    expect(c1).toContain('line29')
  })
})

describe('chunkCaptions — monotonic timestamps', () => {
  test('chunk startSec is monotonically non-decreasing', () => {
    const cues: CaptionCue[] = Array.from({ length: 120 }, (_, i) => cue(`line${i}`, i * 1000, 800))
    const chunks = chunkCaptions(cues)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startSec).toBeGreaterThanOrEqual(chunks[i - 1].startSec)
    }
  })
  test('chunk endSec >= startSec + 1 for every chunk', () => {
    const cues: CaptionCue[] = Array.from({ length: 60 }, (_, i) => cue(`line${i}`, i * 1000, 800))
    const chunks = chunkCaptions(cues)
    for (const c of chunks) {
      expect(c.endSec).toBeGreaterThan(c.startSec)
    }
  })
  test('ordinals are 1-indexed and contiguous', () => {
    const cues: CaptionCue[] = Array.from({ length: 90 }, (_, i) => cue(`line${i}`, i * 1000, 800))
    const chunks = chunkCaptions(cues)
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i + 1))
  })
})

describe('chunkCaptions — gaps and silence', () => {
  test('long silence in the middle is skipped (no empty chunk emitted)', () => {
    // cues at 0..10s then nothing until 60..70s
    const cues: CaptionCue[] = [
      ...Array.from({ length: 10 }, (_, i) => cue(`early${i}`, i * 1000, 800)),
      ...Array.from({ length: 10 }, (_, i) => cue(`late${i}`, (60 + i) * 1000, 800)),
    ]
    const chunks = chunkCaptions(cues)
    // No chunk should have empty content
    for (const c of chunks) {
      expect(c.content.length).toBeGreaterThan(0)
    }
    // Last chunk should be at >= 60s
    const last = chunks[chunks.length - 1]
    expect(last.startSec).toBeGreaterThanOrEqual(60)
  })
})

describe('chunkCaptions — options', () => {
  test('custom window + overlap respected', () => {
    const cues: CaptionCue[] = Array.from({ length: 60 }, (_, i) => cue(`line${i}`, i * 1000, 800))
    const chunks = chunkCaptions(cues, { windowSec: 15, overlapSec: 3 })
    // step = 15 - 3 = 12s
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[1].startSec - chunks[0].startSec).toBe(12)
  })
  test('rejects overlap >= window', () => {
    const cues: CaptionCue[] = [cue('hi', 0, 1000)]
    expect(() => chunkCaptions(cues, { windowSec: 10, overlapSec: 10 })).toThrow()
    expect(() => chunkCaptions(cues, { windowSec: 10, overlapSec: 11 })).toThrow()
  })
  test('rejects window <= 0', () => {
    const cues: CaptionCue[] = [cue('hi', 0, 1000)]
    expect(() => chunkCaptions(cues, { windowSec: 0 })).toThrow()
  })
})

describe('estimateTokens', () => {
  test('empty -> 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
  test('approx char/4', () => {
    expect(estimateTokens('hello world')).toBe(3) // 11 chars -> ceil(11/4)=3
  })
})
