import { test, expect, describe } from 'bun:test'
import { formatTimestamp, formatTimeRange, parseTimestamp } from '../timestamp-format'

describe('formatTimestamp', () => {
  test('0 -> "0:00"', () => {
    expect(formatTimestamp(0)).toBe('0:00')
  })
  test('7 -> "0:07"', () => {
    expect(formatTimestamp(7)).toBe('0:07')
  })
  test('67 -> "1:07"', () => {
    expect(formatTimestamp(67)).toBe('1:07')
  })
  test('3599 -> "59:59"', () => {
    expect(formatTimestamp(3599)).toBe('59:59')
  })
  test('3600 (1hr) -> "1:00:00"', () => {
    expect(formatTimestamp(3600)).toBe('1:00:00')
  })
  test('3723 (1:02:03) -> "1:02:03"', () => {
    expect(formatTimestamp(3723)).toBe('1:02:03')
  })
  test('7200 (2hr) -> "2:00:00"', () => {
    expect(formatTimestamp(7200)).toBe('2:00:00')
  })
  test('negative -> "0:00"', () => {
    expect(formatTimestamp(-5)).toBe('0:00')
  })
  test('NaN -> "0:00"', () => {
    expect(formatTimestamp(NaN)).toBe('0:00')
  })
  test('Infinity -> "0:00"', () => {
    expect(formatTimestamp(Infinity)).toBe('0:00')
  })
  test('truncates fractional seconds', () => {
    expect(formatTimestamp(67.9)).toBe('1:07')
  })
})

describe('formatTimeRange', () => {
  test('under 1 hour', () => {
    expect(formatTimeRange(0, 30)).toBe('0:00 - 0:30')
  })
  test('crossing 1 hour boundary', () => {
    expect(formatTimeRange(3500, 3700)).toBe('58:20 - 1:01:40')
  })
  test('long-form video range', () => {
    expect(formatTimeRange(7200, 7230)).toBe('2:00:00 - 2:00:30')
  })
})

describe('parseTimestamp', () => {
  test('parses plain integer', () => {
    expect(parseTimestamp('120')).toBe(120)
  })
  test('parses 1m30s', () => {
    expect(parseTimestamp('1m30s')).toBe(90)
  })
  test('parses 1h2m3s', () => {
    expect(parseTimestamp('1h2m3s')).toBe(3723)
  })
  test('parses mm:ss (1:30)', () => {
    expect(parseTimestamp('1:30')).toBe(90)
  })
  test('parses h:mm:ss (1:02:03)', () => {
    expect(parseTimestamp('1:02:03')).toBe(3723)
  })
  test('parses "90s"', () => {
    expect(parseTimestamp('90s')).toBe(90)
  })
  test('parses numeric input', () => {
    expect(parseTimestamp(120)).toBe(120)
  })
  test('null/undefined -> undefined', () => {
    expect(parseTimestamp(null)).toBeUndefined()
    expect(parseTimestamp(undefined)).toBeUndefined()
  })
  test('empty -> undefined', () => {
    expect(parseTimestamp('')).toBeUndefined()
  })
  test('garbage -> undefined', () => {
    expect(parseTimestamp('not a timestamp')).toBeUndefined()
  })
  test('negative -> undefined', () => {
    expect(parseTimestamp('-5')).toBeUndefined()
  })
})
