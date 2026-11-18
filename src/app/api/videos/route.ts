/**
 * GET /api/videos — list imported videos with chunk + chapter counts.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const videos = await db.video.findMany({
    orderBy: { importedAt: 'desc' },
    select: {
      id: true,
      youtubeId: true,
      title: true,
      channel: true,
      durationSec: true,
      thumbnailUrl: true,
      importedAt: true,
      _count: { select: { chunks: true, chapters: true } },
    },
  })
  return NextResponse.json({ videos })
}
