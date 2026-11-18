'use client'

import * as React from 'react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Youtube,
  Send,
  Loader2,
  Sparkles,
  Filter,
  Trash2,
  PlayCircle,
  ListVideo,
  X,
  CornerDownLeft,
  ExternalLink,
  Clock,
} from 'lucide-react'
import {
  buildEmbedUrl,
  buildThumbnailUrl,
  tryParseYouTubeUrl,
} from '@/lib/url-parser'
import { formatTimestamp, formatTimeRange } from '@/lib/timestamp-format'

// ---------- types ----------
interface VideoMeta {
  id: string
  youtubeId: string
  title: string
  channel: string | null
  durationSec: number | null
  thumbnailUrl: string | null
  importedAt: string
  _count: { chunks: number; chapters: number }
}
interface Chapter {
  id: string
  ordinal: number
  title: string
  startSec: number
  endSec: number
}
interface Citation {
  chunkId: string
  videoId: string
  videoTitle: string
  startSec: number
  endSec: number
  preview: string
}
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  activeVideoId?: string
  activeStartSec?: number
  pending?: boolean
}

// ---------- helpers ----------
function renderCitationsInline(content: string, onSeek: (citeId: string) => void): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /\[\^(c\d+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      parts.push(<React.Fragment key={`t-${last}`}>{content.slice(last, m.index)}</React.Fragment>)
    }
    const id = m[1]
    parts.push(
      <button
        key={`c-${m.index}`}
        type="button"
        onClick={() => onSeek(id)}
        className="text-primary text-[0.7em] align-super mx-0.5 px-1 rounded bg-primary/10 hover:bg-primary/20 cursor-pointer"
        aria-label={`Citation ${id}`}
      >
        [{id}]
      </button>,
    )
    last = m.index + m[0].length
  }
  if (last < content.length) {
    parts.push(<React.Fragment key={`t-${last}`}>{content.slice(last)}</React.Fragment>)
  }
  return parts
}

function fmtDate(s: string): string {
  const d = new Date(s)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ---------- main ----------
export default function Home() {
  const { toast } = useToast()

  // videos + filter state
  const [videos, setVideos] = React.useState<VideoMeta[]>([])
  const [loadingVideos, setLoadingVideos] = React.useState(true)
  const [stats, setStats] = React.useState<{ videos: number; chunks: number; chapters: number }>({ videos: 0, chunks: 0, chapters: 0 })
  const [filterVideoIds, setFilterVideoIds] = React.useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = React.useState(false)

  // import form
  const [importUrl, setImportUrl] = React.useState('')
  const [importing, setImporting] = React.useState(false)

  // active video + player
  const [activeVideoId, setActiveVideoId] = React.useState<string | null>(null) // internal DB row id
  const [activeYouTubeId, setActiveYouTubeId] = React.useState<string | null>(null)
  const [activeVideoTitle, setActiveVideoTitle] = React.useState<string>('')
  const [chapters, setChapters] = React.useState<Chapter[]>([])
  const [activeStartSec, setActiveStartSec] = React.useState<number>(0)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const pendingSeekRef = React.useRef<number | null>(null)

  // chat state
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const [sessionId, setSessionId] = React.useState<string | null>(null)

  // ---------- initial load ----------
  const refreshVideos = React.useCallback(async () => {
    setLoadingVideos(true)
    try {
      const res = await fetch('/api/videos', { cache: 'no-store' })
      const json = await res.json()
      setVideos(json.videos ?? [])
      const sres = await fetch('/api/stats', { cache: 'no-store' })
      setStats(await sres.json())
    } catch (e) {
      toast({ title: 'Failed to load videos', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoadingVideos(false)
    }
  }, [toast])

  React.useEffect(() => {
    refreshVideos()
  }, [refreshVideos])

  // ---------- import ----------
  async function importVideo() {
    const url = importUrl.trim()
    if (!url) return
    const parsed = tryParseYouTubeUrl(url)
    if (!parsed) {
      toast({ title: 'Invalid YouTube URL', description: 'Expected youtube.com/watch?v=…, youtu.be/…, /embed/…, or /shorts/…', variant: 'destructive' })
      return
    }
    setImporting(true)
    try {
      const res = await fetch('/api/videos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast({
        title: 'Imported transcript',
        description: `${json.title ?? 'Video'} — ${json.chunks} chunks, ${json.chapters} chapters.`,
      })
      setImportUrl('')
      await refreshVideos()
      // Auto-select the freshly-imported video
      if (json.videoId) selectVideo(json.videoId)
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  async function deleteVideo(id: string, title: string) {
    if (!confirm(`Delete "${title}"? Its chunks and chapters will be removed.`)) return
    try {
      const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({ title: 'Video deleted' })
      setFilterVideoIds((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
      if (activeVideoId === id) {
        setActiveVideoId(null)
        setActiveYouTubeId(null)
        setChapters([])
      }
      await refreshVideos()
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // ---------- active video + chapters ----------
  function selectVideo(videoRowId: string) {
    const v = videos.find((x) => x.id === videoRowId)
    if (!v) return
    setActiveVideoId(v.id)
    setActiveYouTubeId(v.youtubeId)
    setActiveVideoTitle(v.title)
    setActiveStartSec(0)
    pendingSeekRef.current = null
    // Load chapters (full video detail includes chapters array)
    fetch(`/api/videos/${v.id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => setChapters(json.video?.chapters ?? []))
      .catch(() => setChapters([]))
  }

  function seekTo(startSec: number, videoRowId?: string) {
    if (videoRowId && videoRowId !== activeVideoId) {
      // Need to switch videos first; queue the seek to fire after iframe reloads.
      selectVideo(videoRowId)
      pendingSeekRef.current = startSec
      return
    }
    if (!iframeRef.current) return
    postSeekToIframe(iframeRef.current, startSec)
    setActiveStartSec(startSec)
  }

  function postSeekToIframe(iframe: HTMLIFrameElement, sec: number) {
    // YouTube IFrame Player API: post a JSON message of the form
      // `{"event":"command","func":"seekTo","args":["<sec>","true"]}`
    const payload = JSON.stringify({ event: 'command', func: 'seekTo', args: [String(sec), 'true'] })
    iframe.contentWindow?.postMessage(payload, '*')
    // Also a play command to make sure the player starts at the seek point.
    iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*')
  }

  function onIframeLoad() {
    if (pendingSeekRef.current != null) {
      const sec = pendingSeekRef.current
      pendingSeekRef.current = null
      // Give the player a moment to be ready after reload.
      setTimeout(() => {
        if (iframeRef.current) {
          postSeekToIframe(iframeRef.current, sec)
          setActiveStartSec(sec)
        }
      }, 300)
    }
  }

  // ---------- chat ----------
  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text, citations: [] }
    const pendingMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', citations: [], pending: true }
    setMessages((m) => [...m, userMsg, pendingMsg])
    setStreaming(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId,
          filterVideoIds: filterVideoIds.size ? Array.from(filterVideoIds) : undefined,
        }),
      })
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => 'request failed')
        throw new Error(errText)
      }
      const sid = res.headers.get('X-Session-Id')
      if (sid) setSessionId(sid)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''
      let footerParsed: {
        sessionId?: string
        citations: Citation[]
        activeVideoId?: string
        activeStartSec?: number
      } | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const sepIdx = buffer.indexOf('\n\n---CITATIONS---\n')
        let body = buffer
        if (sepIdx !== -1) {
          body = buffer.slice(0, sepIdx)
          const footerRaw = buffer.slice(sepIdx + '\n\n---CITATIONS---\n'.length)
          try {
            footerParsed = JSON.parse(footerRaw)
            if (footerParsed?.sessionId) setSessionId(footerParsed.sessionId)
          } catch {
            footerParsed = { citations: [] }
          }
        }
        if (body !== assistantText) {
          assistantText = body
          setMessages((m) =>
            m.map((msg) => (msg.id === pendingMsg.id ? { ...msg, content: assistantText } : msg))
          )
        }
      }
      // Finalize
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? {
              ...msg,
              pending: false,
              content: assistantText,
              citations: footerParsed?.citations ?? [],
              activeVideoId: footerParsed?.activeVideoId,
              activeStartSec: footerParsed?.activeStartSec,
            }
            : msg
        )
      )
    } catch (e) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? { ...msg, pending: false, content: `⚠️ ${(e as Error).message}` }
            : msg
        )
      )
      toast({ title: 'Chat error', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function seekToCitation(citeLabel: string, message: ChatMessage) {
    // citeLabel is `cN` (1-indexed)
    const idx = parseInt(citeLabel.slice(1), 10) - 1
    const cite = message.citations[idx]
    if (!cite) return
    seekTo(cite.startSec, cite.videoId)
  }

  const activeFilterCount = filterVideoIds.size
  const embedUrl = activeYouTubeId ? buildEmbedUrl(activeYouTubeId, activeStartSec || undefined) : null

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
              <Youtube className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight truncate">YouTube Transcript RAG</h1>
              <p className="text-xs text-muted-foreground">
                {stats.videos} videos · {stats.chunks} chunks · {stats.chapters} chapters
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="size-3.5" />
              Docs
            </a>
          </div>
        </div>
      </header>

      {/* Main 3-column layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[300px_1fr_minmax(340px,420px)]">
        {/* Column 1: videos sidebar */}
        <aside className="border-r bg-muted/30 lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] flex flex-col min-h-0">
          <div className="p-4 space-y-3 border-b">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Import video</h2>
            </div>
            <div className="flex gap-2">
              <Input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') importVideo()
                }}
                placeholder="youtube.com/watch?v=…"
                disabled={importing}
                aria-label="YouTube URL"
              />
              <Button size="sm" onClick={importVideo} disabled={importing || !importUrl.trim()} className="shrink-0">
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                <span className="hidden sm:inline">Import</span>
              </Button>
            </div>
          </div>

          <div className="p-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Videos</h2>
            <Button
              variant={filterOpen ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterOpen((v) => !v)}
              disabled={!videos.length}
            >
              <Filter className="size-3.5 mr-1" />
              Filter
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{activeFilterCount}</Badge>
              )}
            </Button>
          </div>
          <Separator />

          {filterOpen && videos.length > 0 && (
            <div className="p-3 border-b bg-background">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Limit search to:</span>
                {activeFilterCount > 0 && (
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilterVideoIds(new Set())}
                  >
                    Clear ({activeFilterCount})
                  </button>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 thin-scroll">
                {videos.map((v) => (
                  <label key={v.id} className="flex items-start gap-2 text-xs cursor-pointer hover:bg-muted/40 rounded p-1">
                    <Checkbox
                      checked={filterVideoIds.has(v.id)}
                      onCheckedChange={(checked) => {
                        setFilterVideoIds((prev) => {
                          const next = new Set(prev)
                          if (checked) next.add(v.id)
                          else next.delete(v.id)
                          return next
                        })
                      }}
                      className="mt-0.5"
                    />
                    <span className="line-clamp-2">{v.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              {loadingVideos ? (
                <>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </>
              ) : videos.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No videos yet. Paste a YouTube URL above to ingest its transcript.
                </div>
              ) : (
                videos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => selectVideo(v.id)}
                    className={`w-full text-left rounded-lg border p-2 transition-colors ${
                      activeVideoId === v.id
                        ? 'bg-primary/10 border-primary/40'
                        : 'hover:bg-muted/40 border-transparent'
                    }`}
                  >
                    <div className="flex gap-2">
                      <div className="relative shrink-0">
                        <img
                          src={v.thumbnailUrl ?? buildThumbnailUrl(v.youtubeId)}
                          alt={v.title}
                          className="size-16 rounded-md object-cover bg-muted"
                          loading="lazy"
                        />
                        {v.durationSec != null && (
                          <span className="absolute bottom-0.5 right-0.5 text-[10px] bg-black/80 text-white px-1 rounded">
                            {formatTimestamp(v.durationSec)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium line-clamp-2">{v.title}</p>
                        {v.channel && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{v.channel}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {v._count.chunks} chunks · {v._count.chapters} chapters
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteVideo(v.id, v.title)
                        }}
                        className="size-6 grid place-items-center text-muted-foreground hover:text-destructive rounded shrink-0"
                        aria-label={`Delete ${v.title}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Column 2: chat */}
        <section className="flex flex-col min-h-[60vh] lg:h-[calc(100vh-57px)] border-r min-w-0">
          <div className="px-4 py-2 border-b bg-background/95 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold truncate">
                {activeVideoTitle ? `Chatting about: ${activeVideoTitle}` : 'Chat'}
              </h2>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">filter: {activeFilterCount}</Badge>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
              {messages.length === 0 ? (
                <EmptyState hasVideos={videos.length > 0} />
              ) : (
                messages.map((m) => (
                  <MessageBubble key={m.id} message={m} onSeekCite={(label) => seekToCitation(label, m)} />
                ))
              )}
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="border-t bg-background/95 backdrop-blur p-3">
            <div className="max-w-3xl mx-auto">
              {activeFilterCount > 0 && (
                <div className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Filter className="size-3" />
                  Searching only in {activeFilterCount} selected video{activeFilterCount === 1 ? '' : 's'}.
                  <button className="text-primary hover:underline" onClick={() => setFilterVideoIds(new Set())}>
                    Clear
                  </button>
                </div>
              )}
              <div className="relative">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask anything about the transcript… (Enter to send, Shift+Enter for newline)"
                  className="pr-12 min-h-[44px] max-h-44 resize-y"
                  disabled={streaming}
                />
                <Button
                  size="icon"
                  className="absolute right-1.5 bottom-1.5 size-8"
                  onClick={sendMessage}
                  disabled={streaming || !input.trim()}
                  aria-label="Send message"
                >
                  {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1">
                <CornerDownLeft className="size-3" /> to send
                <span className="mx-1">·</span>
                <Sparkles className="size-3" /> Click a citation chip to jump the player
              </div>
            </div>
          </div>
        </section>

        {/* Column 3: player + chapters */}
        <section className="flex flex-col min-h-0 lg:h-[calc(100vh-57px)] bg-background">
          {embedUrl ? (
            <>
              <div className="p-3 border-b">
                <div className="aspect-video rounded-lg overflow-hidden bg-black">
                  <iframe
                    ref={iframeRef}
                    src={embedUrl}
                    title={activeVideoTitle}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    onLoad={onIframeLoad}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium line-clamp-1">{activeVideoTitle}</p>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    <Clock className="size-3 mr-1" />
                    {formatTimestamp(activeStartSec)}
                  </Badge>
                </div>
              </div>
              <div className="px-3 py-2 flex items-center justify-between gap-2 border-b">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <ListVideo className="size-4" />
                  Chapters
                </div>
                <Badge variant="secondary" className="text-[10px]">{chapters.length}</Badge>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {chapters.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground text-center">
                      No chapters detected. Import a longer video to trigger chapter detection.
                    </div>
                  ) : (
                    chapters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => seekTo(c.startSec)}
                        className={`w-full text-left rounded-md p-2 transition-colors ${
                          activeStartSec >= c.startSec && activeStartSec < c.endSec
                            ? 'bg-primary/10 border-l-2 border-primary'
                            : 'hover:bg-muted/40 border-l-2 border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium line-clamp-1">{c.title}</span>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {formatTimestamp(c.startSec)}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatTimeRange(c.startSec, c.endSec)}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 grid place-items-center p-8 text-center">
              <div>
                <div className="size-14 rounded-full bg-primary/10 grid place-items-center mx-auto mb-4">
                  <PlayCircle className="size-7 text-primary" />
                </div>
                <h2 className="text-sm font-semibold mb-1">No video selected</h2>
                <p className="text-xs text-muted-foreground max-w-[220px] mx-auto">
                  Import a YouTube URL from the sidebar to start chatting with its transcript. Citation chips will seek the player here.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

// ---------- sub-components ----------
function MessageBubble({
  message,
  onSeekCite,
}: {
  message: ChatMessage
  onSeekCite: (label: string) => void
}) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] ${isUser ? 'order-2' : ''}`}>
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap'
              : 'rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap'
          }
        >
          {isUser ? message.content : renderCitationsInline(message.content, onSeekCite)}
          {message.pending && (
            <span className="inline-flex items-center gap-1 ml-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
            </span>
          )}
        </div>
        {!isUser && message.citations.length > 0 && !message.pending && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Sources</p>
            {message.citations.map((c, i) => (
              <button
                key={c.chunkId}
                onClick={() => onSeekCite(`c${i + 1}`)}
                className="block w-full text-left text-xs bg-background border rounded-md p-2 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground line-clamp-1">{c.videoTitle}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0 font-mono">
                    {formatTimestamp(c.startSec)}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {formatTimeRange(c.startSec, c.endSec)}
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-2">{c.preview}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ hasVideos }: { hasVideos: boolean }) {
  return (
    <div className="py-16 text-center max-w-md mx-auto">
      <div className="size-14 rounded-full bg-primary/10 grid place-items-center mx-auto mb-4">
        <Sparkles className="size-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Chat with the transcript</h2>
      <p className="text-sm text-muted-foreground">
        {hasVideos
          ? 'Ask a question — answers are grounded in the imported transcript with timestamp-anchored citations. Click a citation chip to jump the player.'
          : 'Paste a YouTube URL in the sidebar to ingest its transcript. You can then ask questions and every answer cites the exact moment in the video.'}
      </p>
    </div>
  )
}
