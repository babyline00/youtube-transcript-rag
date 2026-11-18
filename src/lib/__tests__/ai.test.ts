import { test, expect, describe } from 'bun:test'
import { buildRagSystemPrompt, extractCitations, type ChatProvider, getChatProvider, __setChatProviderForTest } from '../ai'
import type { RetrievedChunk } from '../retrieval'

const retrieved: RetrievedChunk[] = [
  {
    chunkId: 'ck-aaa',
    videoId: 'video-1',
    videoTitle: 'Intro to React',
    startSec: 30,
    endSec: 60,
    content: 'The component lifecycle has three phases: mount, update, and unmount.',
    bm25Score: 4.2,
    vectorScore: 0.81,
    fusedScore: 0.016,
  },
  {
    chunkId: 'ck-bbb',
    videoId: 'video-1',
    videoTitle: 'Intro to React',
    startSec: 222,
    endSec: 252,
    content: 'Hooks let you reuse stateful logic across components without changing the hierarchy.',
    bm25Score: 2.1,
    vectorScore: 0.74,
    fusedScore: 0.012,
  },
]

describe('buildRagSystemPrompt', () => {
  test('includes all retrieved chunk contents', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt).toContain('component lifecycle')
    expect(systemPrompt).toContain('Hooks let you reuse')
  })
  test('includes the citation rules', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt.toLowerCase()).toContain('citation')
    expect(systemPrompt).toContain('[^c1]')
  })
  test('includes timestamp-anchored source hints', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    // 30s -> 0:30, 60s -> 1:00, 222s -> 3:42, 252s -> 4:12
    expect(systemPrompt).toContain('0:30')
    expect(systemPrompt).toContain('1:00')
    expect(systemPrompt).toContain('3:42')
    expect(systemPrompt).toContain('4:12')
  })
  test('empty retrieved -> safe-mode prompt', () => {
    const { systemPrompt, citationMap } = buildRagSystemPrompt([])
    expect(systemPrompt.toLowerCase()).toContain('no transcripts')
    expect(Object.keys(citationMap)).toHaveLength(0)
  })
  test('citation map carries startSec/endSec/videoId/videoTitle/preview', () => {
    const { citationMap } = buildRagSystemPrompt(retrieved)
    const c = citationMap['ck-aaa']
    expect(c).toBeDefined()
    expect(c.videoId).toBe('video-1')
    expect(c.videoTitle).toBe('Intro to React')
    expect(c.startSec).toBe(30)
    expect(c.endSec).toBe(60)
    expect(c.preview).toContain('component lifecycle')
  })
})

describe('extractCitations', () => {
  test('returns chunkIds in citation order', () => {
    const msg = 'The lifecycle has three phases [^c1]. Hooks reuse logic [^c2].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-aaa', 'ck-bbb'])
  })
  test('dedupes repeated citations', () => {
    const msg = 'A [^c1] then again [^c1].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-aaa'])
  })
  test('ignores out-of-range markers', () => {
    const msg = 'Bogus citation [^c99].'
    expect(extractCitations(msg, retrieved)).toEqual([])
  })
  test('no citations -> []', () => {
    expect(extractCitations('no markers here', retrieved)).toEqual([])
  })
})

describe('ChatProvider (mock)', () => {
  class MockChat implements ChatProvider {
    async *stream(args: { systemPrompt: string; messages: { role: string; content: string }[] }) {
      yield 'mocked response for: '
      yield args.messages[args.messages.length - 1].content
    }
  }
  test('streams concatenated deltas', async () => {
    __setChatProviderForTest(new MockChat())
    const provider = getChatProvider()
    const out: string[] = []
    for await (const d of provider.stream({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      out.push(d)
    }
    expect(out.join('')).toBe('mocked response for: hello')
    __setChatProviderForTest(null)
  })
})
