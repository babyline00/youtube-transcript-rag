import { test, expect, describe } from 'bun:test'
import { BM25Index } from '../bm25'
import { tokenize } from '../tokenizer'

const corpus = [
  'the quick brown fox jumps over the lazy dog',
  'fast brown foxes are common in north america',
  'lazy dogs sleep all day in the warm sun',
  'react frontend development with typescript and tailwind',
  'building a rag pipeline with vector search and bm25',
  'quantum physics uses linear algebra and probability',
].map((text, i) => ({ id: `d${i}`, tokens: tokenize(text) }))

describe('BM25Index', () => {
  test('returns ranked hits for a relevant query', () => {
    const idx = new BM25Index(corpus)
    const hits = idx.search('fox lazy dog')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].id).toBe('d0')
  })
  test('no matches -> empty result', () => {
    const idx = new BM25Index(corpus)
    const hits = idx.search('zzzznonexistent')
    expect(hits).toEqual([])
  })
  test('topK limit is respected', () => {
    const idx = new BM25Index(corpus)
    const hits = idx.search('the brown fox', 2)
    expect(hits.length).toBeLessThanOrEqual(2)
  })
  test('respects topK = 0 (returns nothing)', () => {
    const idx = new BM25Index(corpus)
    expect(idx.search('fox', 0)).toEqual([])
  })
  test('empty corpus -> empty result', () => {
    const idx = new BM25Index([])
    expect(idx.search('fox')).toEqual([])
    expect(idx.size).toBe(0)
  })
  test('IDF weighting favours rarer terms', () => {
    const idx = new BM25Index(corpus)
    const hits = idx.search('quantum')
    expect(hits.length).toBe(1)
    expect(hits[0].id).toBe('d5')
  })
})
