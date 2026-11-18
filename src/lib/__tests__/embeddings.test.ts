import { test, expect, describe } from 'bun:test'
import { hashingEmbed, cosine, serializeVector, deserializeVector, EMBED_DIM } from '../embeddings'

describe('hashingEmbed', () => {
  test('returns a fixed-length Float32Array', () => {
    const v = hashingEmbed('hello world')
    expect(v).toBeInstanceOf(Float32Array)
    expect(v.length).toBe(EMBED_DIM)
  })
  test('empty input -> zero vector', () => {
    const v = hashingEmbed('')
    expect(v.every((x) => x === 0)).toBe(true)
  })
  test('identical text -> identical vector (deterministic)', () => {
    expect(hashingEmbed('hello world')).toEqual(hashingEmbed('hello world'))
  })
  test('cosine of identical vectors = 1', () => {
    const a = hashingEmbed('the quick brown fox')
    expect(cosine(a, a)).toBeCloseTo(1, 5)
  })
  test('cosine of overlapping text > cosine of disjoint text', () => {
    const a = hashingEmbed('react next.js frontend')
    const b = hashingEmbed('react frontend hooks')
    const c = hashingEmbed('quantum physics astronomy')
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c))
  })
  test('normalised (L2 norm = 1)', () => {
    const a = hashingEmbed('some text here for embedding')
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 4)
  })
})

describe('serialize / deserialize', () => {
  test('round-trips a vector', () => {
    const v = hashingEmbed('hello')
    const s = serializeVector(v)
    const v2 = deserializeVector(s)
    expect(Array.from(v2)).toEqual(Array.from(v))
  })
  test('cosine on a deserialised vector equals cosine on the original', () => {
    const v1 = hashingEmbed('hello world')
    const v2 = deserializeVector(serializeVector(v1))
    expect(cosine(v1, v2)).toBeCloseTo(1, 5)
  })
})
