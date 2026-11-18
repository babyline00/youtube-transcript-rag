import { test, expect, describe } from 'bun:test'
import { reciprocalRankFusion, fuseHits, type RankedHit } from '../hybrid-search'

const bm25: RankedHit[] = [
  { id: 'a', score: 5.1 },
  { id: 'b', score: 4.2 },
  { id: 'c', score: 3.0 },
]
const vector: RankedHit[] = [
  { id: 'c', score: 0.91 },
  { id: 'a', score: 0.88 },
  { id: 'd', score: 0.7 },
]

describe('reciprocalRankFusion', () => {
  test('a document ranked high in both retrievers ranks highest', () => {
    const fused = reciprocalRankFusion([bm25, vector])
    expect(fused[0].id).toBe('a')
  })
  test('document only in one retriever still appears', () => {
    const fused = reciprocalRankFusion([bm25, vector])
    const ids = fused.map((h) => h.id)
    expect(ids).toContain('b')
    expect(ids).toContain('d')
  })
  test('topK is respected', () => {
    const fused = reciprocalRankFusion([bm25, vector], { topK: 2 })
    expect(fused.length).toBe(2)
  })
  test('RRF k parameter influences ranking', () => {
    const fusedSmallK = reciprocalRankFusion([bm25, vector], { k: 1 })
    expect(fusedSmallK[0].id).toBe('a')
  })
  test('empty inputs -> empty result', () => {
    expect(reciprocalRankFusion([])).toEqual([])
    expect(reciprocalRankFusion([[], []])).toEqual([])
  })
})

describe('fuseHits', () => {
  test('returns hits with both raw scores + fused score', () => {
    const fused = fuseHits(bm25, vector, { topK: 5 })
    expect(fused.length).toBeGreaterThan(0)
    const a = fused.find((h) => h.id === 'a')!
    expect(a.bm25Score).toBeCloseTo(5.1, 5)
    expect(a.vectorScore).toBeCloseTo(0.88, 5)
    expect(a.fusedScore).toBeGreaterThan(0)
  })
  test('document missing from one retriever has 0 score there', () => {
    const fused = fuseHits(bm25, vector, { topK: 10 })
    const b = fused.find((h) => h.id === 'b')!
    expect(b.bm25Score).toBeCloseTo(4.2, 5)
    expect(b.vectorScore).toBe(0)
  })
})
