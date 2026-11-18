/**
 * Retrieval service: given a user query and (optionally) a filtered set of
 * video IDs, returns the top-K most relevant transcript chunks via hybrid
 * retrieval.
 *
 * Mirrors the pattern from the personal-notes RAG project: in-memory corpus
 * cache invalidated when chunks change, BM25 + vector cosine via RRF fusion.
 * The chunk payload now includes startSec / endSec so the chat footer can
 * pass them to the embedded YouTube IFrame player.
 */

import { db } from '@/lib/db'
import { tokenize } from '@/lib/tokenizer'
import { BM25Index } from '@/lib/bm25'
import {
  getEmbeddingProvider,
  cosine,
  deserializeVector,
  type EmbeddingProvider,
} from '@/lib/embeddings'
import { fuseHits, type SearchHit } from '@/lib/hybrid-search'

export interface RetrievedChunk {
  chunkId: string
  videoId: string
  videoTitle: string
  startSec: number
  endSec: number
  content: string
  bm25Score: number
  vectorScore: number
  fusedScore: number
}

const TOP_K = 8

interface CorpusState {
  chunkIds: string[]
  videoIds: string[]
  videoTitles: string[]
  startSecs: number[]
  endSecs: number[]
  contents: string[]
  tokens: string[][]
  vectors: Float32Array[]
  bm25: BM25Index
  signature: string
}

let corpusState: CorpusState | null = null

async function computeCorpusSignature(): Promise<string> {
  const count = await db.videoChunk.count()
  const latest = await db.videoChunk.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } })
  return `${count}:${latest?.id ?? ''}`
}

async function loadCorpus(provider: EmbeddingProvider): Promise<CorpusState> {
  const chunks = await db.videoChunk.findMany({
    include: { video: { select: { title: true } } },
    orderBy: [{ videoId: 'asc' }, { ordinal: 'asc' }],
  })

  const chunkIds: string[] = []
  const videoIds: string[] = []
  const videoTitles: string[] = []
  const startSecs: number[] = []
  const endSecs: number[] = []
  const contents: string[] = []
  const tokens: string[][] = []
  const vectors: Float32Array[] = []

  for (const c of chunks) {
    chunkIds.push(c.id)
    videoIds.push(c.videoId)
    videoTitles.push(c.video.title)
    startSecs.push(c.startSec)
    endSecs.push(c.endSec)
    contents.push(c.content)
    try {
      tokens.push(JSON.parse(c.tokens) as string[])
    } catch {
      tokens.push(tokenize(c.content))
    }
    try {
      vectors.push(deserializeVector(c.embedding))
    } catch {
      vectors.push(await provider.embed(c.content))
    }
  }

  return {
    chunkIds,
    videoIds,
    videoTitles,
    startSecs,
    endSecs,
    contents,
    tokens,
    vectors,
    bm25: new BM25Index(tokens.map((t, i) => ({ id: chunkIds[i], tokens: t }))),
    signature: await computeCorpusSignature(),
  }
}

async function getCorpus(): Promise<CorpusState> {
  const sig = await computeCorpusSignature()
  if (corpusState && corpusState.signature === sig) {
    return corpusState
  }
  const provider = getEmbeddingProvider()
  corpusState = await loadCorpus(provider)
  return corpusState
}

/** Force a reload on next access — used by the import API after adding videos. */
export function invalidateCorpus() {
  corpusState = null
}

export interface RetrieveOptions {
  /** When set, only chunks from these video row IDs are searched. */
  filterVideoIds?: string[]
  topK?: number
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? TOP_K
  const corpus = await getCorpus()
  if (!corpus.chunkIds.length) return []

  const filter = opts.filterVideoIds && opts.filterVideoIds.length > 0
    ? new Set(opts.filterVideoIds)
    : null

  const filteredIdx: number[] = []
  for (let i = 0; i < corpus.chunkIds.length; i++) {
    if (filter && !filter.has(corpus.videoIds[i])) continue
    filteredIdx.push(i)
  }
  if (!filteredIdx.length) return []

  const bm25Hits = (() => {
    if (!filter) {
      return corpus.bm25.search(query, topK * 2)
    }
    const filteredDocs = filteredIdx.map((i) => ({
      id: corpus.chunkIds[i],
      tokens: corpus.tokens[i],
    }))
    const sub = new BM25Index(filteredDocs)
    return sub.search(query, topK * 2)
  })()

  const provider = getEmbeddingProvider()
  const qVec = await provider.embed(query)

  const vecHits = filteredIdx
    .map((i) => ({
      id: corpus.chunkIds[i],
      score: cosine(qVec, corpus.vectors[i]),
      idx: i,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2)

  const fused = fuseHits(
    bm25Hits.map((h) => ({ id: h.id, score: h.score })),
    vecHits.map((h) => ({ id: h.id, score: h.score })),
    { topK },
  )

  const idToIdx = new Map(corpus.chunkIds.map((id, i) => [id, i]))
  return fused.map((f): RetrievedChunk => {
    const i = idToIdx.get(f.id)!
    return {
      chunkId: corpus.chunkIds[i],
      videoId: corpus.videoIds[i],
      videoTitle: corpus.videoTitles[i],
      startSec: corpus.startSecs[i],
      endSec: corpus.endSecs[i],
      content: corpus.contents[i],
      bm25Score: f.bm25Score,
      vectorScore: f.vectorScore,
      fusedScore: f.fusedScore,
    }
  })
}

/** Total counts — used by the UI header. */
export async function corpusStats(): Promise<{ videos: number; chunks: number; chapters: number }> {
  const [videos, chunks, chapters] = await Promise.all([
    db.video.count(),
    db.videoChunk.count(),
    db.chapter.count(),
  ])
  return { videos, chunks, chapters }
}
