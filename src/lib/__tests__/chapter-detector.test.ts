import { test, expect, describe } from 'bun:test'
import {
  detectChapterBoundaries,
  heuristicChapterTitle,
  buildChapterSeeds,
  parseChapterTitles,
} from '../chapter-detector'
import { hashingEmbed, EMBED_DIM } from '../embeddings'
import type { CaptionChunk } from '../chunker'

function fakeChunk(ordinal: number, startSec: number, endSec: number, content: string): CaptionChunk {
  return { ordinal, startSec, endSec, content }
}

function fakeVec(): Float32Array {
  // A fixed non-zero vector that all the unrelated-chunk tests can reuse.
  const v = new Float32Array(EMBED_DIM)
  v[0] = 1
  return v
}

describe('detectChapterBoundaries — gap-based split', () => {
  test('gap > 30s splits into two chapters', () => {
    const chunks: CaptionChunk[] = [
      fakeChunk(1, 0, 30, 'first segment'),
      fakeChunk(2, 70, 100, 'second segment after a 40s gap'),
    ]
    const vectors = [hashingEmbed('first segment'), hashingEmbed('second segment after a 40s gap')]
    const boundaries = detectChapterBoundaries(chunks, vectors)
    expect(boundaries.length).toBe(2)
    expect(boundaries[0].startIdx).toBe(0)
    expect(boundaries[1].startIdx).toBe(1)
  })
  test('gap <= 30s does NOT split', () => {
    const chunks: CaptionChunk[] = [
      fakeChunk(1, 0, 30, 'first'),
      fakeChunk(2, 35, 65, 'second after a 5s gap'),
    ]
    const vectors = [fakeVec(), fakeVec()]
    const boundaries = detectChapterBoundaries(chunks, vectors)
    expect(boundaries.length).toBe(1)
  })
})

describe('detectChapterBoundaries — cosine-distance split', () => {
  test('cosine distance > 0.6 splits even with no gap', () => {
    const chunks: CaptionChunk[] = [
      fakeChunk(1, 0, 30, 'react frontend development'),
      fakeChunk(2, 30, 60, 'quantum mechanics and particle physics'),
    ]
    const vectors = [hashingEmbed('react frontend development'), hashingEmbed('quantum mechanics and particle physics')]
    const boundaries = detectChapterBoundaries(chunks, vectors)
    // distance = 1 - cosine. Hashing-trick on disjoint tokens gives cosine ~0.
    expect(boundaries.length).toBe(2)
    expect(boundaries[1].startIdx).toBe(1)
  })
  test('cosine distance < 0.6 does NOT split', () => {
    const chunks: CaptionChunk[] = [
      fakeChunk(1, 0, 30, 'react frontend development hooks'),
      fakeChunk(2, 30, 60, 'react hooks for frontend development'),
    ]
    const vectors = [hashingEmbed('react frontend development hooks'), hashingEmbed('react hooks for frontend development')]
    const boundaries = detectChapterBoundaries(chunks, vectors)
    // Very similar text -> high cosine -> low distance -> no split
    expect(boundaries.length).toBe(1)
  })
})

describe('detectChapterBoundaries — edge cases', () => {
  test('empty chunks -> empty boundaries', () => {
    expect(detectChapterBoundaries([], [])).toEqual([])
  })
  test('single chunk -> single chapter', () => {
    const chunks = [fakeChunk(1, 0, 30, 'only one chunk')]
    const vectors = [hashingEmbed('only one chunk')]
    expect(detectChapterBoundaries(chunks, vectors).length).toBe(1)
  })
  test('throws on chunk/vector length mismatch', () => {
    const chunks = [fakeChunk(1, 0, 30, 'a')]
    expect(() => detectChapterBoundaries(chunks, [])).toThrow(/length/)
  })
  test('multiple boundaries mark all chapter ends correctly', () => {
    const chunks: CaptionChunk[] = [
      fakeChunk(1, 0, 30, 'intro'),
      fakeChunk(2, 70, 100, 'gap!'),
      fakeChunk(3, 105, 130, 'after another small gap'),
      fakeChunk(4, 200, 230, 'big topic shift to quantum physics astronomy'),
    ]
    const vectors = [
      hashingEmbed('intro'),
      hashingEmbed('gap!'),
      hashingEmbed('after another small gap'),
      hashingEmbed('big topic shift to quantum physics astronomy'),
    ]
    const boundaries = detectChapterBoundaries(chunks, vectors)
    // chunks 1 and 2 have a 40s gap (split), chunk 2->3 has 5s gap (depends on cosine),
    // chunk 3->4 has 70s gap (split). Let's at least assert 2 chapters.
    expect(boundaries.length).toBeGreaterThanOrEqual(2)
    // First chapter always starts at 0
    expect(boundaries[0].startIdx).toBe(0)
    // Last chapter always ends at chunks.length
    expect(boundaries[boundaries.length - 1].endIdx).toBe(chunks.length)
  })
})

describe('heuristicChapterTitle', () => {
  test('returns first 6 words of first chunk', () => {
    const chunks = [fakeChunk(1, 0, 30, 'welcome back to my channel today')]
    const title = heuristicChapterTitle(chunks, { startIdx: 0, endIdx: 1 })
    expect(title).toBe('welcome back to my channel today')
  })
  test('falls back to "Chapter N" when chunk has no content', () => {
    const chunks = [fakeChunk(1, 0, 30, '')]
    const title = heuristicChapterTitle(chunks, { startIdx: 0, endIdx: 1 })
    expect(title).toBe('Chapter 1')
  })
  test('falls back when boundary startIdx is out of range', () => {
    const chunks = [fakeChunk(1, 0, 30, 'a')]
    const title = heuristicChapterTitle(chunks, { startIdx: 5, endIdx: 6 })
    expect(title).toBe('Chapter 6')
  })
})

describe('buildChapterSeeds', () => {
  test('returns one seed per boundary', () => {
    const chunks: CaptionChunk[] = [
      fakeChunk(1, 0, 30, 'first'),
      fakeChunk(2, 30, 60, 'second'),
    ]
    const boundaries = [
      { startIdx: 0, endIdx: 1 },
      { startIdx: 1, endIdx: 2 },
    ]
    const seeds = buildChapterSeeds(chunks, boundaries)
    expect(seeds.length).toBe(2)
    expect(seeds[0].ordinal).toBe(1)
    expect(seeds[0].startSec).toBe(0)
    expect(seeds[0].endSec).toBe(30)
    expect(seeds[1].startSec).toBe(30)
    expect(seeds[1].endSec).toBe(60)
  })
  test('seedText contains content from first up-to-3 chunks', () => {
    const chunks: CaptionChunk[] = [
      fakeChunk(1, 0, 30, 'aaa'),
      fakeChunk(2, 30, 60, 'bbb'),
      fakeChunk(3, 60, 90, 'ccc'),
      fakeChunk(4, 90, 120, 'ddd'),
    ]
    const boundaries = [{ startIdx: 0, endIdx: 4 }]
    const seeds = buildChapterSeeds(chunks, boundaries)
    expect(seeds[0].seedText).toContain('aaa')
    expect(seeds[0].seedText).toContain('bbb')
    expect(seeds[0].seedText).toContain('ccc')
    expect(seeds[0].seedText).not.toContain('ddd')
  })
})

describe('parseChapterTitles', () => {
  test('parses "N. Title" lines in order', () => {
    const resp = '1. Introduction\n2. Architecture Overview\n3. Demo'
    const seeds = [
      { ordinal: 1, startSec: 0, endSec: 30, seedText: 'introduction' },
      { ordinal: 2, startSec: 30, endSec: 60, seedText: 'architecture overview' },
      { ordinal: 3, startSec: 60, endSec: 90, seedText: 'demo' },
    ]
    const titles = parseChapterTitles(resp, seeds)
    expect(titles).toEqual(['Introduction', 'Architecture Overview', 'Demo'])
  })
  test('fills missing lines with heuristic titles from seedText', () => {
    const resp = '1. Intro\n\n3. Demo'
    const seeds = [
      { ordinal: 1, startSec: 0, endSec: 30, seedText: 'welcome to the channel' },
      { ordinal: 2, startSec: 30, endSec: 60, seedText: 'in this section we discuss architecture' },
      { ordinal: 3, startSec: 60, endSec: 90, seedText: 'now let me show you a demo' },
    ]
    const titles = parseChapterTitles(resp, seeds)
    expect(titles[0]).toBe('Intro')
    expect(titles[1]).toBe('in this section we discuss architecture') // heuristic 6 words
    expect(titles[2]).toBe('Demo')
  })
  test('empty response -> all heuristic titles', () => {
    const seeds = [
      { ordinal: 1, startSec: 0, endSec: 30, seedText: 'welcome back to my channel' },
    ]
    const titles = parseChapterTitles('', seeds)
    expect(titles[0]).toBe('welcome back to my channel')
  })
  test('ignores out-of-range ordinal lines', () => {
    const resp = '1. Intro\n99. Bogus'
    const seeds = [{ ordinal: 1, startSec: 0, endSec: 30, seedText: 'intro' }]
    const titles = parseChapterTitles(resp, seeds)
    expect(titles.length).toBe(1)
    expect(titles[0]).toBe('Intro')
  })
})
