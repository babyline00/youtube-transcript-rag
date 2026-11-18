/**
 * Streaming RAG chat. Wraps the z-ai-web-dev-sdk chat completion endpoint with
 * a retrieval-augmented system prompt that instructs the model to ground each
 * claim in a retrieved chunk via inline `[^chunkId]` markers.
 *
 * The interface `ChatProvider` has a single method that returns a string
 * stream; `ZaiProvider` implements it using the SDK available in the sandbox.
 *
 * Citations for YouTube transcripts carry `startSec` / `endSec` so the UI can
 * postMessage('seekTo', startSec) to an embedded YouTube IFrame player — the
 * user clicks a chip and the player jumps to the moment that backs the claim.
 */

import type { RetrievedChunk } from '@/lib/retrieval'

export interface ChatProvider {
  stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown>
}

let cachedProvider: ChatProvider | null = null

class ZaiProvider implements ChatProvider {
  async *stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown> {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const messages = [
      { role: 'system' as const, content: args.systemPrompt },
      ...args.messages,
    ]
    const completion = await zai.chat.completions.create({
      messages,
      stream: true,
      thinking: { type: 'disabled' },
    })

    if (typeof completion === 'string') {
      yield completion
      return
    }
    let body: ReadableStream<Uint8Array> | undefined
    if (completion && typeof (completion as any).getReader === 'function') {
      body = completion as ReadableStream<Uint8Array>
    } else {
      body = (completion as any)?.body ?? (completion as any)?._body
    }
    if (!body) {
      const content = (completion as any)?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.length > 0) yield content
      return
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const obj = JSON.parse(payload)
          const delta = obj?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) yield delta
        } catch {
          // ignore partial JSON
        }
      }
    }
  }
}

class MockProvider implements ChatProvider {
  async *stream(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): AsyncGenerator<string, void, unknown> {
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    yield `[mock assistant] No live LLM configured. You asked: "${(lastUser?.content ?? '').slice(0, 120)}". ` +
      `Set the SDK config to enable real streaming grounded in transcript chunks.`
  }
}

export function getChatProvider(): ChatProvider {
  if (cachedProvider) return cachedProvider
  if (process.env.YT_RAG_DISABLE_LLM === '1') {
    cachedProvider = new MockProvider()
    return cachedProvider
  }
  try {
    cachedProvider = new ZaiProvider()
  } catch (e) {
    console.warn('[chat] ZaiProvider unavailable, using MockProvider:', (e as Error).message)
    cachedProvider = new MockProvider()
  }
  return cachedProvider
}

export function __setChatProviderForTest(p: ChatProvider | null) {
  cachedProvider = p
}

/**
 * Build the system prompt that grounds the assistant in retrieved transcript
 * chunks and instructs it to cite chunks inline using `[^cN]` markers. The
 * citation map carries video title + startSec/endSec + preview so the UI can
 * render clickable chips that jump the embedded YouTube player.
 */
export function buildRagSystemPrompt(retrieved: RetrievedChunk[]): {
  systemPrompt: string
  citationMap: Record<string, {
    chunkId: string
    videoId: string
    videoTitle: string
    startSec: number
    endSec: number
    preview: string
  }>
} {
  if (!retrieved.length) {
    return {
      systemPrompt:
        'You are YouTube Transcript RAG. No transcripts have been imported yet. ' +
        'Tell the user to paste a YouTube URL in the sidebar to ingest a transcript.',
      citationMap: {},
    }
  }
  const chunkLines: string[] = []
  const citationMap: Record<string, {
    chunkId: string
    videoId: string
    videoTitle: string
    startSec: number
    endSec: number
    preview: string
  }> = {}
  retrieved.forEach((c, i) => {
    const shortId = `c${i + 1}`
    const ts = `[${formatTs(c.startSec)} - ${formatTs(c.endSec)}]`
    chunkLines.push(
      `[^${shortId}]: (chunkId=${c.chunkId}) Source: "${c.videoTitle}" at ${ts}\n${c.content}`,
    )
    citationMap[c.chunkId] = {
      chunkId: c.chunkId,
      videoId: c.videoId,
      videoTitle: c.videoTitle,
      startSec: c.startSec,
      endSec: c.endSec,
      preview: c.content.slice(0, 160).replace(/\s+/g, ' ').trim(),
    }
  })
  const systemPrompt = [
    'You are YouTube Transcript RAG — a RAG assistant that answers questions strictly grounded in imported YouTube transcripts.',
    'Below are the most relevant transcript chunks retrieved for the user\'s question. Each chunk is anchored to a timestamp range.',
    'Rules:',
    '1. Answer ONLY using the information present in the provided transcript chunks. If the answer is not in the chunks, say "I don\'t have that in this transcript."',
    '2. Every factual claim MUST be followed by an inline citation in the form [^c1], [^c2], etc. — the marker MUST match the chunkId label.',
    '3. When a chunk supports a claim about a specific moment in the video, refer to the timestamp naturally (e.g. "at 3:42 [^c2] the speaker says…").',
    '4. Do not fabricate sources. Do not invent quotes. Do not paraphrase beyond what the transcripts support.',
    '5. Use markdown for structure (lists, emphasis) where it improves readability.',
    '',
    'Retrieved transcript chunks:',
    chunkLines.join('\n\n---\n\n'),
  ].join('\n')
  return { systemPrompt, citationMap }
}

/** Local copy of timestamp formatting (avoids a circular import in tests). */
function formatTs(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '0:00'
  const s = Math.floor(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/**
 * Map short citation markers like [^c1] in the assistant message back to
 * chunk IDs. Returns an ordered list of unique chunkIds actually cited.
 */
export function extractCitations(message: string, retrieved: RetrievedChunk[]): string[] {
  const seen = new Set<string>()
  const re = /\[\^(c\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const idx = parseInt(m[1].slice(1), 10) - 1
    if (idx >= 0 && idx < retrieved.length) {
      seen.add(retrieved[idx].chunkId)
    }
  }
  return Array.from(seen)
}

/**
 * Non-streaming batched call used by the import route to title all chapters
 * at once. Returns null on failure (caller falls back to heuristic titles).
 */
export async function titleChaptersBatched(seeds: { ordinal: number; seedText: string }[]): Promise<string | null> {
  if (!seeds.length) return null
  if (process.env.YT_RAG_DISABLE_LLM === '1') return null
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const prompt = [
      'You are labelling chapters for a YouTube video. Given one line per chapter with its first ~240 chars of transcript, output a short (<=6 words) title for each chapter on its own line in the form `N. Title`. No prose, no preamble.',
      '',
      ...seeds.map((s) => `${s.ordinal}. ${s.seedText}`),
    ].join('\n')
    const completion = await zai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
    })
    if (typeof completion === 'string') return completion
    const content = (completion as any)?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.length > 0) return content
    return null
  } catch (e) {
    console.warn('[chapter-titler] LLM call failed, using heuristic:', (e as Error).message)
    return null
  }
}
