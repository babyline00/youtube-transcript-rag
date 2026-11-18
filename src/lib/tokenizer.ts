/**
 * Lightweight tokenizer used by both BM25 and the hashing-embedding fallback.
 *
 * Rules:
 *  - lowercase
 *  - strip markdown control chars (`#`, `*`, `_`, `` ` ``, `[`, `]`, etc.)
 *  - split on non-alphanumeric (Unicode-aware), keep CJK characters as single tokens
 *  - drop tokens shorter than 2 chars (English side) — CJK single chars are kept
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of',
  'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it',
  'its', 'i', 'we', 'you', 'they', 'he', 'she', 'him', 'her', 'his', 'hers',
  'our', 'ours', 'your', 'yours', 'their', 'theirs', 'so', 'not', 'no',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having', 'will',
  'would', 'should', 'could', 'can', 'may', 'might', 'must', 'shall',
  'about', 'into', 'over', 'under', 'again', 'more', 'most', 'some', 'any',
  'than', 'too', 'very', 'just', 'also', 'only', 'up', 'down', 'out',
  'how', 'why', 'when', 'where', 'what', 'which', 'who', 'whom',
  'am', 'me', 'my', 'mine', 'us', 'them', 'there', 'here',
  'um', 'uh', 'like', 'kind', 'sort', 'yeah', 'yep', 'okay', 'ok',
])

const CJK_STOP_WORDS = new Set(['的', '了', '是', '在', '也', '都', '与', '及', '和'])

export function tokenize(text: string): string[] {
  if (!text) return []
  const stripped = text
    .toLowerCase()
    .replace(/[`*_~#\[\](){}|>!]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  const tokens: string[] = []
  const re = /[\p{L}\p{N}]+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    const tok = m[0]
    const isCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(tok)
    if (isCjk) {
      for (const ch of tok) {
        if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch) && !CJK_STOP_WORDS.has(ch)) {
          tokens.push(ch)
        }
      }
      continue
    }
    if (tok.length < 2) continue
    if (STOP_WORDS.has(tok)) continue
    tokens.push(tok)
  }
  return tokens
}

/** Token frequency map. */
export function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1)
  }
  return tf
}
