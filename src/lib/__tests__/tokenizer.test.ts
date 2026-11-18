import { test, expect, describe } from 'bun:test'
import { tokenize, termFrequencies } from '../tokenizer'

describe('tokenize', () => {
  test('lowercases', () => {
    expect(tokenize('Hello WORLD')).toEqual(['hello', 'world'])
  })
  test('strips markdown control chars', () => {
    expect(tokenize('# **Bold** and _italic_')).toEqual(['bold', 'italic'])
  })
  test('drops 1-char non-CJK tokens and stop words', () => {
    const toks = tokenize('a b c d the and I am')
    expect(toks).toEqual([])
  })
  test('keeps CJK single-char tokens', () => {
    const toks = tokenize('你好 世界')
    expect(toks).toContain('你')
    expect(toks).toContain('好')
    expect(toks).toContain('世')
    expect(toks).toContain('界')
  })
  test('strips URLs', () => {
    const toks = tokenize('see https://example.com/path?x=1 details inside')
    expect(toks).not.toContain('https')
    expect(toks).not.toContain('example')
    expect(toks).toContain('see')
    expect(toks).toContain('details')
    expect(toks).toContain('inside')
  })
  test('empty string -> []', () => {
    expect(tokenize('')).toEqual([])
  })
  test('drops filler words common in transcripts', () => {
    const toks = tokenize('um uh like yeah okay so basically')
    expect(toks).not.toContain('um')
    expect(toks).not.toContain('uh')
    expect(toks).not.toContain('like')
    expect(toks).not.toContain('yeah')
    expect(toks).not.toContain('okay')
    expect(toks).toContain('basically')
  })
})

describe('termFrequencies', () => {
  test('counts repeated tokens', () => {
    const tf = termFrequencies(tokenize('apple apple banana'))
    expect(tf.get('apple')).toBe(2)
    expect(tf.get('banana')).toBe(1)
  })
  test('empty tokens -> empty map', () => {
    expect(termFrequencies([]).size).toBe(0)
  })
})
