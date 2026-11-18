import { test, expect, describe } from 'bun:test'
import { parseYouTubeUrl, tryParseYouTubeUrl, parseTimeParam, buildEmbedUrl, buildThumbnailUrl } from '../url-parser'

describe('parseYouTubeUrl — watch URL', () => {
  test('parses watch?v=ID', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
  test('parses watch URL with extra params', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLfoo&t=120')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
    expect(r.startSec).toBe(120)
  })
  test('parses m.youtube.com variant', () => {
    const r = parseYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
})

describe('parseYouTubeUrl — youtu.be short URL', () => {
  test('parses youtu.be/ID', () => {
    const r = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
  test('parses youtu.be/ID?t=90', () => {
    const r = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=90')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
    expect(r.startSec).toBe(90)
  })
})

describe('parseYouTubeUrl — embed / shorts / live', () => {
  test('parses /embed/ID', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
  test('parses /shorts/ID', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
  test('parses /live/ID', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
  test('parses /v/ID', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/v/dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
})

describe('parseYouTubeUrl — time offset parsing', () => {
  test('parses t=120 (plain seconds)', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120')
    expect(r.startSec).toBe(120)
  })
  test('parses start=90 (alias)', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=90')
    expect(r.startSec).toBe(90)
  })
  test('parses t=1m30s (h/m/s form)', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')
    expect(r.startSec).toBe(90)
  })
  test('parses t=1h2m3s (mixed h/m/s)', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s')
    expect(r.startSec).toBe(3723)
  })
  test('no t= -> undefined', () => {
    const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r.startSec).toBeUndefined()
  })
})

describe('parseYouTubeUrl — rejection', () => {
  test('rejects non-YouTube host', () => {
    expect(() => parseYouTubeUrl('https://vimeo.com/123456789')).toThrow(/not a youtube url/)
  })
  test('rejects malformed video id', () => {
    expect(() => parseYouTubeUrl('https://www.youtube.com/watch?v=tooshort')).toThrow(/video id/)
  })
  test('rejects empty input', () => {
    expect(() => parseYouTubeUrl('')).toThrow()
  })
  test('tryParse returns null on rejection', () => {
    expect(tryParseYouTubeUrl('https://vimeo.com/123')).toBeNull()
  })
})

describe('parseYouTubeUrl — scheme-less input', () => {
  test('accepts youtu.be/ID without scheme', () => {
    const r = parseYouTubeUrl('youtu.be/dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
})

describe('parseYouTubeUrl — bare ID', () => {
  test('accepts a bare 11-char ID', () => {
    const r = parseYouTubeUrl('dQw4w9WgXcQ')
    expect(r.videoId).toBe('dQw4w9WgXcQ')
  })
})

describe('parseTimeParam', () => {
  test('parses plain integer seconds', () => {
    expect(parseTimeParam('120')).toBe(120)
  })
  test('parses 1m (returns 60)', () => {
    expect(parseTimeParam('1m')).toBe(60)
  })
  test('parses 1m30s', () => {
    expect(parseTimeParam('1m30s')).toBe(90)
  })
  test('returns undefined for empty', () => {
    expect(parseTimeParam(null)).toBeUndefined()
    expect(parseTimeParam('')).toBeUndefined()
  })
})

describe('buildEmbedUrl / buildThumbnailUrl', () => {
  test('embed URL uses youtube-nocookie + enablejsapi=1', () => {
    const u = buildEmbedUrl('dQw4w9WgXcQ')
    expect(u).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(u).toContain('enablejsapi=1')
  })
  test('embed URL with start appends &start=', () => {
    const u = buildEmbedUrl('dQw4w9WgXcQ', 90)
    expect(u).toContain('start=90')
  })
  test('embed URL without start omits &start=', () => {
    const u = buildEmbedUrl('dQw4w9WgXcQ')
    expect(u).not.toContain('start=')
  })
  test('thumbnail URL uses i.ytimg.com', () => {
    expect(buildThumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  })
})
