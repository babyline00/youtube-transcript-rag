/**
 * POST /api/videos/import — body `{ url }`
 *
 *  1. Parse the URL into a video ID + optional start offset.
 *  2. Fetch the transcript via the `youtube-transcript` package.
 *  3. Chunk by 30s windows + 5s overlap.
 *  4. Embed each chunk.
 *  5. Detect chapters via gap + cosine distance.
 *  6. Title chapters in ONE batched LLM call (heuristic fallback if it fails).
 *  7. Persist video, chapters, chunks to the DB.
 *
 * Returns `{ ok, videoId, title, chunks, chapters }`.
 *
 * Re-importing the same `youtubeId` replaces the prior video's chunks +
 * chapters (idempotent on YouTube ID).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tryParseYouTubeUrl, buildThumbnailUrl } from '@/lib/url-parser'
import { chunkCaptions, type CaptionCue } from '@/lib/chunker'
import { tokenize } from '@/lib/tokenizer'
import { getEmbeddingProvider, serializeVector } from '@/lib/embeddings'
import {
  detectChapterBoundaries,
  buildChapterSeeds,
  heuristicChapterTitle,
  parseChapterTitles,
} from '@/lib/chapter-detector'
import { titleChaptersBatched } from '@/lib/ai'
import { invalidateCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

interface ImportBody {
  url: string
}

interface TranscriptResponse {
  importing: boolean
  done: boolean
  content: () => string
  events: { segs?: { utf8?: string }[] }[]
}

async function fetchTranscript(videoId: string): Promise<{ cues: CaptionCue[]; title: string; channel: string | null; durationSec: number | null }> {
  // Dynamic import so the module is only loaded when needed.
  const mod = await import('youtube-transcript')
  const fetcher = (mod as any).default ?? (mod as any).YouTubeTranscript
  const raw = await fetcher.fetchTranscript(videoId, { lang: 'en' })

  const cues: CaptionCue[] = (raw as any[])
    .filter((r) => r && typeof r.text === 'string')
    .map((r) => ({
      text: r.text,
      offsetMs: Number(r.offset ?? 0),
      durationMs: Number(r.duration ?? 0),
    }))

  if (!cues.length) throw new Error('Transcript is empty or unavailable for this video.')

  // Heuristic duration: end of last cue + 1s (or offset + duration of last cue).
  const last = cues[cues.length - 1]
  const durationSec = Math.ceil((last.offsetMs + last.durationMs) / 1000)

  // We can't reliably fetch the title via the youtube-transcript package.
  // We try the oEmbed endpoint (no API key required) and fall back to the
  // video id as the title.
  let title = `YouTube video ${videoId}`
  let channel: string | null = null
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
    if (oembedRes.ok) {
      const oembed = await oembedRes.json()
      if (typeof oembed.title === 'string') title = oembed.title
      if (typeof oembed.author_name === 'string') channel = oembed.author_name
    }
  } catch {
    // network blocked — keep the default title
  }

  return { cues, title, channel, durationSec }
}

export async function POST(req: NextRequest) {
  let body: ImportBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = tryParseYouTubeUrl(body.url ?? '')
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid YouTube URL. Expected youtube.com/watch?v=…, youtu.be/…, /embed/…, or /shorts/…' },
      { status: 400 },
    )
  }

  try {
    const { cues, title, channel, durationSec } = await fetchTranscript(parsed.videoId)
    if (!cues.length) {
      return NextResponse.json({ error: 'No transcript available for this video.' }, { status: 422 })
    }

    // 1. Chunk captions into 30s windows + 5s overlap.
    const chunks = chunkCaptions(cues)
    if (!chunks.length) {
      return NextResponse.json({ error: 'Chunking produced no chunks.' }, { status: 422 })
    }

    // 2. Embed each chunk.
    const provider = getEmbeddingProvider()
    const vectors: Float32Array[] = []
    for (const chunk of chunks) {
      const v = await provider.embed(chunk.content)
      vectors.push(v)
    }

    // 3. Detect chapters.
    const boundaries = detectChapterBoundaries(chunks, vectors)
    const seeds = buildChapterSeeds(chunks, boundaries)

    // 4. Title chapters in ONE batched LLM call (or heuristic fallback).
    let chapterTitles: string[]
    const llmResp = await titleChaptersBatched(seeds)
    if (llmResp) {
      chapterTitles = parseChapterTitles(llmResp, seeds)
    } else {
      chapterTitles = boundaries.map((b, i) => heuristicChapterTitle(chunks, b, 6) || `Chapter ${i + 1}`)
    }

    // 5. Idempotent on youtubeId: replace prior video with same YouTube id.
    const existing = await db.video.findUnique({ where: { youtubeId: parsed.videoId } })
    if (existing) {
      await db.video.delete({ where: { id: existing.id } })
    }

    // 6. Persist video.
    const video = await db.video.create({
      data: {
        youtubeId: parsed.videoId,
        title,
        channel,
        durationSec,
        thumbnailUrl: buildThumbnailUrl(parsed.videoId),
      },
    })

    // 7. Persist chapters.
    const chapterRows = await Promise.all(
      boundaries.map((b, i) =>
        db.chapter.create({
          data: {
            videoId: video.id,
            ordinal: i + 1,
            title: chapterTitles[i] ?? `Chapter ${i + 1}`,
            startSec: seeds[i].startSec,
            endSec: seeds[i].endSec,
          },
        }),
      ),
    )

    // 8. Persist chunks (with chapter link).
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      // Find chapter this chunk falls into.
      const chapterIdx = boundaries.findIndex((b) => i >= b.startIdx && i < b.endIdx)
      const chapterId = chapterIdx >= 0 ? chapterRows[chapterIdx].id : null
      const tokens = tokenize(chunk.content)
      await db.videoChunk.create({
        data: {
          videoId: video.id,
          ordinal: chunk.ordinal,
          startSec: chunk.startSec,
          endSec: chunk.endSec,
          chapterId,
          content: chunk.content,
          tokens: JSON.stringify(tokens),
          embedding: serializeVector(vectors[i]),
        },
      })
    }

    invalidateCorpus()

    return NextResponse.json({
      ok: true,
      videoId: video.id,
      youtubeId: parsed.videoId,
      title,
      chunks: chunks.length,
      chapters: boundaries.length,
    })
  } catch (e) {
    console.error('[api/videos/import] error:', e)
    const msg = (e as Error).message ?? 'Internal Server Error'
    if (msg.toLowerCase().includes('transcript')) {
      return NextResponse.json({ error: `Could not fetch transcript: ${msg}` }, { status: 422 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
