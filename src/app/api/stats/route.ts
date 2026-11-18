/**
 * GET /api/stats — corpus size summary (used by the UI header).
 */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { corpusStats } from '@/lib/retrieval'

export const runtime = 'nodejs'

export async function GET() {
  // corpusStats already does the three counts in parallel.
  const stats = await corpusStats()
  return NextResponse.json(stats)
}
