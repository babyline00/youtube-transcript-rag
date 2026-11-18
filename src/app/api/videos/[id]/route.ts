/**
 * GET  /api/videos/[id] — full video detail (including chapters array).
 * DELETE /api/videos/[id] — remove a video + chunks + chapters (cascade).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidateCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const video = await db.video.findUnique({
    where: { id },
    include: {
      chapters: {
        orderBy: { ordinal: 'asc' },
        select: { id: true, ordinal: true, title: true, startSec: true, endSec: true },
      },
    },
  })
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  return NextResponse.json({ video })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const video = await db.video.findUnique({ where: { id } })
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 })
    }
    await db.video.delete({ where: { id } })
    invalidateCorpus()
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/videos/:id] delete error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
