# YouTube Transcript RAG

Paste a YouTube video URL, ingest its transcript, and ask questions with **timestamp-anchored citations** that jump the embedded player to the exact moment a claim came from. Built as Project #13 of the 110-project portfolio plan.

Three columns: a **videos sidebar** (with thumbnails + per-video filter), a **streaming chat** (with inline `[^c1]` citations), and an **embedded YouTube IFrame player** (with a chapter list). Every citation chip is a `seekTo` action — click it and the player jumps.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  YouTube Transcript RAG       3 videos · 412 chunks · 18 chapters          │
├──────────────┬─────────────────────────────────┬───────────────────────────┤
│  Import      │  Chat                            │  ┌─────────────────────┐  │
│  [youtube..] │  You: What are hooks?            │  │                     │  │
│  [Import]    │  Copilot: Hooks let you reuse    │  │   Embedded Player   │  │
│              │  stateful logic across components │  │   (youtube-nocookie  │  │
│  Videos      │  [^c1]...                         │  │   /embed/ID)        │  │
│  [Filter]    │                                  │  └─────────────────────┘  │
│  □ Intro     │  SOURCES                         │  Chapters (5)            │
│  ☑ React     │  ┌──────────────────────────┐    │  ▶ 1. Intro     0:00     │
│  □ Hooks     │  │ Intro to React  3:42-4:12 │    │  ▶ 2. Setup    1:30     │
│              │  │ "Hooks let you reuse..."  │    │  ▶ 3. Hooks    3:42     │
│              │  └──────────────────────────┘    │  ▶ 4. Demo     12:00     │
│              │  Ask anything...        [Send ▶] │  ▶ 5. Q&A     18:30     │
└──────────────┴─────────────────────────────────┴───────────────────────────┘
```

---

## Features

- **Single-video URL ingestion** — paste any `youtube.com/watch?v=…`, `youtu.be/…`, `/embed/…`, or `/shorts/…` URL. The `youtube-transcript` package fetches captions and the app persists the video with chunks, chapters, and embeddings.
- **Timestamp-anchored chunking** — captions are grouped into **30-second windows with a 5-second overlap** so retrieval matches across boundaries. Each chunk carries `startSec` / `endSec` for citation anchoring.
- **Auto chapter detection** — split at gaps > 30s OR cosine distance > 0.6 between adjacent chunk embeddings (semantic topic shift). Titles generated in **one batched LLM call** with a heuristic "first 6 words" fallback when the LLM is unavailable.
- **Streaming RAG chat** — same `text/plain + \n\n---CITATIONS---\n{json}` protocol as Project #1. Citations include `{ chunkId, videoId, videoTitle, startSec, endSec, preview }`. The footer also carries `activeVideoId` + `activeStartSec` so the UI can hint the player.
- **Embedded YouTube IFrame** — `youtube-nocookie.com/embed/ID?enablejsapi=1&start=NN`. Citation chips **postMessage `seekTo`** to the iframe via the IFrame Player API. Clicking a chapter does the same.
- **3-column responsive layout** — videos sidebar (with thumbnails + per-video filter), chat (with streaming + citations), embedded player (with chapter list). Collapses to a single column on mobile.
- **Hybrid retrieval** — Okapi BM25 + cosine similarity over hashing-trick embeddings, fused via **Reciprocal Rank Fusion (RRF, k=60)**. Both retrievers contribute even when only one finds a chunk.
- **Local-first storage** — SQLite + Prisma. Vectors serialized as JSON-encoded `Float32Array` so the app runs anywhere without `pgvector` / `sqlite-vec`.
- **Pluggable embeddings** — defaults to a deterministic hashing embedder (offline, no API key). Set `EMBEDDINGS_API_KEY` (or `OPENAI_API_KEY`) + `EMBEDDINGS_BASE_URL` to swap in `text-embedding-3-small` or any OpenAI-compatible endpoint.
- **30+ unit tests** — url-parser, chunker, tokenizer, embeddings, BM25, RRF fusion, RAG prompt builder, citation extraction, chapter detection, timestamp formatting. Pure-function modules, ~50ms total runtime.

---

## MVP scope vs. stretch

| Scope | Done in this build | Stretch (documented, not shipped) |
|---|---|---|
| URL parsing | `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/`, `&t=`/`&start=` with `1m30s` h/m/s form | — |
| Ingestion | Single-video URL, transcript fetch, chunking, embedding, persistence | Channel/playlist ingestion (would need YouTube Data API v3 + key) |
| Chunking | 30s windows + 5s overlap, monotonic timestamps | Variable-window based on cue density |
| Chapter detection | Gap > 30s OR cosine distance > 0.6, batched LLM titling with heuristic fallback | Topic-clustering with embeddings + silhouette score |
| Chat | Streaming, hybrid retrieval, `[^cN]` citation markers, postMessage `seekTo` to iframe | Multi-turn follow-up suggestion chips |
| Player | `youtube-nocookie.com/embed/ID?enablejsapi=1&start=NN`, chapter seek, citation seek | Playback speed control, captions overlay |
| Persistence | SQLite via Prisma, conversation history per session | Per-user accounts (NextAuth), shareable sessions |
| Embeddings | Hashing-trick default + OpenAI-compat provider via env | Local `bge-micro` via transformers.js |
| Tests | 30+ pure-function unit tests | Playwright e2e for the 3-column flow |

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Streaming Route Handlers, Partial Prerendering |
| Language | TypeScript 5 (strict) | End-to-end type safety |
| Styling | Tailwind CSS 4 + shadcn/ui | Copy-paste component primitives, theme tokens |
| Database | SQLite + Prisma 6 | Local-first, zero-infra. Embeddings serialized as JSON in `TEXT` columns. |
| Transcript fetch | `youtube-transcript` package | Scrapes the public timedtext API — no API key required |
| LLM streaming | `z-ai-web-dev-sdk` chat completions (`stream: true`) | Pluggable `ChatProvider` interface |
| Retrieval | Custom Okapi BM25 + hashing-trick embeddings + RRF | 100% in-process, no external embedding API required |
| Player | YouTube IFrame Player API (`enablejsapi=1`, `youtube-nocookie.com`) | `postMessage('seekTo')` for citation seek |
| Tests | `bun test` | Built-in, ~50ms for the full suite |
| Lint | ESLint (`eslint-config-next`) | Next.js + TypeScript rules |

---

## Architecture

```
                ┌───────────────────────────────────────────────────────────┐
                │              Next.js 16 (App Router)                      │
                │                                                          │
  YouTube URL ─►  POST /api/videos/import                                  │
                │     │                                                    │
                │     ├─ parseYouTubeUrl()                                  │
                │     ├─ youtube-transcript.fetchTranscript(videoId)        │
                │     ├─ chunkCaptions()  (30s windows + 5s overlap)        │
                │     ├─ hashingEmbed() per chunk                           │
                │     ├─ detectChapterBoundaries()  (gap > 30s | cos > 0.6) │
                │     ├─ titleChaptersBatched()  (one LLM call)             │
                │     └─► SQLite (Prisma)                                  │
                │             Video / VideoChunk / Chapter                  │
                │             / ChatSession / ChatMessage                  │
                │                       ▲                                  │
                │   POST /api/chat ─►  retrieve()  ───────────────────────┘
                │          │           (BM25 + cosine → RRF)
                │          ▼
                │   buildRagSystemPrompt(retrieved)
                │          │
                │          ▼
                │   ChatProvider.stream()  ─►  z-ai-web-dev-sdk  (streaming SSE)
                │          │
                │          ▼
                │   extractCitations(message) → DB persist + UI footer
                │     footer carries { citations, activeVideoId, activeStartSec }
                │                                                          │
                │   Frontend (page.tsx):                                     │
                │     iframe.postMessage('seekTo', sec)  ◄── citation chip  │
                │     iframe.postMessage('seekTo', sec)  ◄── chapter click   │
                └───────────────────────────────────────────────────────────┘
```

### Retrieval pipeline

1. **Parse URL** — accept every YouTube URL shape (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/live/`, `/v/`). Reject non-YouTube hosts and malformed video IDs (must be 11 chars). Parse `t=` / `start=` for time offsets including `1m30s` / `1h2m3s` forms.
2. **Fetch transcript** — `youtube-transcript` scrapes the public timedtext endpoint. Returns `[{ text, offset, durationMs }]` cues. We also call the public `oEmbed` endpoint to grab the human-readable title + channel name (no API key).
3. **Chunk captions** — walk the cue list and emit 30-second windows. Each cue is assigned to the window whose center it overlaps. Step = 25s so the last 5s of cues bleed into the next chunk (the overlap). Chunks carry absolute `startSec` / `endSec`.
4. **Tokenize** — lowercase → strip markdown control chars → strip URLs → split on `[\p{L}\p{N}]+`. CJK runs split into single-char tokens. Extra transcript stop-words (`um`, `uh`, `like`, `yeah`, `okay`) dropped.
5. **Embed** — hashing-trick signed-bag-of-features (384-dim, FNV-1a, L2-normalised). Drop-in replaceable with `text-embedding-3-small` via env.
6. **Detect chapters** — walk adjacent chunks. Split when:
   - `curr.startSec - prev.endSec > 30` (a >30s silence/pause in the transcript), OR
   - `1 - cosine(prev, curr) > 0.6` (a strong semantic topic shift).
7. **Title chapters** — collect up to 3 chunks of seed text per chapter, send them all in ONE batched LLM call (`1. Title\n2. Title\n…`), parse the response. If the LLM is unavailable (no key, network blocked, `YT_RAG_DISABLE_LLM=1`), fall back to "first 6 words of the first chunk" — deterministic and useful enough for navigation.
8. **BM25** — classic Okapi (`k1=1.5`, `b=0.75`). Document frequency table built once per corpus load. Filtered queries build a sub-index on the fly.
9. **Fusion** — Reciprocal Rank Fusion, `score(d) = Σ 1/(k + rank_in_retriever(d))` with `k=60`. Robust to the different score scales of BM25 and cosine.

### Chat pipeline

1. Retrieve top-8 chunks (filtered by selected video IDs if the user toggled the sidebar filter).
2. Build a system prompt listing each chunk with a `[^c1]`, `[^c2]`, … citation label and explicit rules: "answer ONLY from the chunks", "cite every factual claim", "say *I don't have that in this transcript* if the chunks don't support the answer", "refer to timestamps naturally".
3. Stream the LLM token-by-token to the client (`text/plain`).
4. After the stream ends, parse `[^cN]` markers out of the assistant message, build a `{ chunkId, videoId, videoTitle, startSec, endSec, preview }` citation list, persist the assistant message + citations, and append a structured `---CITATIONS---` JSON footer. The footer also carries `activeVideoId` + `activeStartSec` (the most-cited chunk's anchor) so the UI can seek the player without an extra round-trip.

### Player pipeline

- The right column renders `https://www.youtube-nocookie.com/embed/{id}?enablejsapi=1&rel=0&start={sec}`.
- Clicking a citation chip calls `iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [sec, 'true'] }), '*')` followed by a `playVideo` command so the seek lands while the player is playing.
- Clicking a chapter does the same.
- When the citation belongs to a different video, the iframe `src` is swapped and the seek is queued (`pendingSeekRef`); it fires `onLoad` after the new iframe finishes reloading.

---

## Setup

```bash
# 1. clone
git clone <this-repo>
cd youtube-transcript-rag

# 2. install
bun install

# 3. create the SQLite database (the .env already points at ./db/custom.db)
mkdir -p db
bun run db:push

# 4. dev server
bun run dev
# open http://localhost:3000 and paste a YouTube URL
```

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./db/custom.db` | Absolute SQLite path. `.env.example` ships a sensible default. |
| `EMBEDDINGS_API_KEY` | unset | Set to use OpenAI-compatible embeddings. Falls back to hashing embedder when unset. |
| `EMBEDDINGS_BASE_URL` | `https://api.openai.com/v1` | Override to point at Azure OpenAI / OpenRouter / self-hosted. |
| `EMBEDDINGS_MODEL` | `text-embedding-3-small` | Any model the endpoint accepts. |
| `YT_RAG_DISABLE_LLM` | unset | Set to `1` to use the deterministic mock chat provider (offline demos / CI). |

The `db:push` and `db:generate` scripts inline `DATABASE_URL="$(pwd)/db/custom.db"` so they work even if `.env` is missing.

---

## Tests

```bash
bun test
```

30+ tests across 9 files — every pure-function module is covered. Run in ~50ms total.

```
✓ src/lib/__tests__/url-parser.test.ts          (~28 tests)
✓ src/lib/__tests__/chunker.test.ts             (~14 tests)
✓ src/lib/__tests__/chapter-detector.test.ts    (~17 tests)
✓ src/lib/__tests__/timestamp-format.test.ts     (~25 tests)
✓ src/lib/__tests__/tokenizer.test.ts             (~9 tests)
✓ src/lib/__tests__/embeddings.test.ts            (~8 tests)
✓ src/lib/__tests__/bm25.test.ts                  (~6 tests)
✓ src/lib/__tests__/hybrid-search.test.ts         (~7 tests)
✓ src/lib/__tests__/ai.test.ts                   (~10 tests)
```

Run a single file:

```bash
bun test src/lib/__tests__/url-parser.test.ts
```

---

## Project structure

```
.
├── prisma/
│   └── schema.prisma              # Video, VideoChunk, Chapter, ChatSession, ChatMessage
├── db/                            # SQLite db lands here (gitignored)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts            # streaming RAG chat (text/plain + CITATIONS footer)
│   │   │   ├── stats/route.ts           # corpus size summary
│   │   │   ├── videos/route.ts          # GET list with chunk+chapter counts
│   │   │   ├── videos/import/route.ts   # POST { url } -> chunk + embed + persist
│   │   │   └── videos/[id]/route.ts     # GET detail / DELETE
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # 3-column layout (videos | chat | player)
│   │   └── globals.css
│   ├── components/ui/                   # shadcn/ui (button, card, input, textarea,
│   │                                    # badge, separator, checkbox, scroll-area,
│   │                                    # skeleton, label, toast, toaster)
│   ├── hooks/use-toast.ts
│   └── lib/
│       ├── ai.ts                       # ChatProvider + RAG prompt + citation extractor + chapter titler
│       ├── bm25.ts                     # Okapi BM25
│       ├── chapter-detector.ts         # gap + cosine-distance boundaries + heuristic titler
│       ├── chunker.ts                  # caption 30s-window chunker
│       ├── db.ts                       # Prisma client singleton
│       ├── embeddings.ts               # hashing + OpenAI-compat providers
│       ├── hybrid-search.ts            # RRF fusion
│       ├── retrieval.ts                # in-memory corpus + retrieve(query, filterVideoIds)
│       ├── timestamp-format.ts         # mm:ss / h:mm:ss formatting + parser
│       ├── tokenizer.ts                # lowercase / markdown strip / CJK split / transcript filler
│       ├── url-parser.ts               # YouTube URL parser + embed/thumbnail URL builder
│       ├── utils.ts                    # cn() Tailwind helper
│       └── __tests__/                  # 30+ unit tests
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json
├── eslint.config.mjs
├── .env / .env.example
├── .gitignore
├── LICENSE
└── README.md
```

---

## Case study

### Problem

YouTube is one of the largest free knowledge bases on the planet (lectures, tutorials, conference talks, interviews) but it's unsearchable in any meaningful sense. You can scrub through a 90-minute podcast for the bit where they mention your specific question, or you can ask a generic LLM that has no idea what was said. Neither scales.

### Approach

Treat the YouTube transcript as a citation source for a RAG chat — but anchor every citation to a **timestamp**, not just a document. The user reads an answer, sees a `[^c1]` chip, clicks it, and the embedded player seeks to the moment the claim came from. The transcript becomes *addressable* in a way that a transcript file alone isn't.

### Key engineering decisions

1. **Timestamp-anchored chunking as the first-class primitive.** Every chunk carries absolute `startSec` / `endSec`. The citation footer carries them. The chapter list and the citation chips both call `iframe.postMessage('seekTo', sec)`. This is the entire reason the project exists — the timestamp is the citation, not a footnote.

2. **30s windows + 5s overlap.** Captions arrive at irregular cadence (one per few seconds). Fixed 30s windows keep chunks a reasonable size for retrieval (~50-100 words of spoken content). The 5s overlap prevents retrieval from missing a topic that straddles two windows — a question about "the bit at 29:30" should hit whichever chunk covered 28-31s, not just the one that started at 30s.

3. **Auto chapter detection = gap OR cosine.** Two signals because each alone misses a class of boundary. Gap > 30s catches silence (a long pause between topics) — but a topic shift with no silence is invisible to that rule. Cosine distance > 0.6 catches semantic topic shifts with no silence — but two adjacent chunks of the same topic can drift enough in vocabulary to trigger a false split. AND-ing them would miss both classes; OR-ing them catches both, with a small false-positive rate that the LLM titler absorbs (you just get a slightly shorter chapter than ideal).

4. **Batched chapter titling.** One LLM call produces titles for ALL chapters in one shot, not N calls. Cost is O(1) per video for titling instead of O(chapters). The fallback heuristic ("first 6 words of the first chunk") is good enough that an offline demo still has usable chapter names — and the same fallback is used in unit tests so they don't need an LLM key.

5. **Same streaming protocol as Project #1.** `text/plain` stream of LLM deltas + `\n\n---CITATIONS---\n{json}` footer. No SSE, no OpenAI stream shape, no special headers. The client reads with `getReader()` + `TextDecoder`, splits on the separator, parses the footer. The footer now carries `activeVideoId` + `activeStartSec` in addition to the citations array — one extra field that lets the UI auto-seek the player to the most-cited chunk on the first answer.

6. **postMessage `seekTo` instead of reloading the iframe.** Setting `iframe.src` to a new URL with `&start=NN` would seek but also reload the player (a 1-2 second flash). Using the IFrame Player API's `seekTo` command via `postMessage` keeps the player running and just jumps — instant. When the citation's video is different from the active one, we have no choice but to swap `src`, so we queue the seek and fire it on `onLoad`.

### What I'd do differently

- **Detect chapters before chunking**, not after. Right now chunking creates 30s windows and then chapters are groups of those windows — but the chapter boundary is constrained to fall on a chunk boundary. A more accurate chapter detector would look at the raw cue stream and split at gaps / topic shifts directly, then chunk within each chapter. Cleaner model, no awkward boundary quantisation.
- **Use the official YouTube Data API v3** for transcript + metadata. The `youtube-transcript` package scrapes the public timedtext endpoint, which is fragile (subject to breakage when YouTube changes its HTML) and has no auto-generated-caption fallback. The Data API gives you stable transcript access, video duration, chapter markers (if the creator set them in the description), and topic categories — at the cost of an API key and quota.
- **Persist the IFrame player state across citation seeks.** When the user clicks a chip mid-answer, the seek fires immediately but the player's `playVideo` command may not have started yet, so the seek lands while paused. Adding an `onYouTubeIframeAPIReady` integration (rather than the raw `postMessage` API) would give us state-aware seeks.
- **Channel ingestion as a first-class operation.** Currently a single-video URL. A "ingest this channel's last 20 videos" flow would be ~50 lines of code on top of the existing import route, gated by the YouTube Data API key. Skipped from MVP because it doubles the surface area for a feature that's strictly less polished than per-video ingestion.
- **Add a transcript-pane view** alongside the chat. Clicking a citation chip seeks the player AND scrolls the transcript to that line — a third synchronisation channel. The current two (player + chat) cover 90% of the value; the third is polish.
- **Re-rank the fused top-20 with a cross-encoder** (e.g. `bge-reranker-base`) before sending to the LLM. RRF gets us most of the way; a re-ranker would lift precision noticeably on long videos where the same word appears in unrelated contexts.

---

## Resume bullet

> Built a YouTube transcript RAG that ingests any video URL, chunks the caption stream into 30s + 5s-overlap windows, auto-detects chapters via gap + cosine-distance signals (LLM-titled in one batched call), and answers questions with timestamp-anchored citations that postMessage `seekTo` to an embedded IFrame player. 30+ unit tests across URL parsing, chunking, embeddings, BM25, RRF fusion, chapter detection, and timestamp formatting.

---

## License

MIT. Build it, fork it, ship it.

---

## Pushing to GitHub (one-time setup)

This repo is intentionally per-repo so it can be deployed independently. From your local clone:

```bash
# inside the youtube-transcript-rag directory
git init -b main
git add .
git commit -m "feat: YouTube Transcript RAG — Phase 1 Project #13

Paste a YouTube URL, ingest the transcript, ask questions with
timestamp-anchored citations that seek the embedded player.

- Single-video URL ingestion via youtube-transcript (watch, youtu.be, embed, shorts)
- Timestamp-anchored chunking: 30s windows + 5s overlap
- Auto chapter detection: gap > 30s OR cosine distance > 0.6
- Batched LLM chapter titling with heuristic fallback
- Streaming RAG chat with [^cN] citations + seekTo postMessage to iframe
- 3-column layout: videos sidebar | chat | embedded player + chapter list
- Hybrid retrieval: Okapi BM25 + cosine over hashing-trick embeddings, RRF fusion
- 30+ unit tests across url-parser, chunker, chapter-detector, timestamp-format,
  tokenizer, embeddings, BM25, RRF, RAG prompt + citation extraction"

# create the repo on GitHub first (web UI or `gh repo create`)
gh repo create youtube-transcript-rag --public --source=. --remote=origin --push

# or, if you prefer the manual flow:
git remote add origin git@github.com:YOUR_USERNAME/youtube-transcript-rag.git
git push -u origin main
```
