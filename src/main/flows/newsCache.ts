const TTL_MS = 15 * 60 * 1000

interface Entry { text: string; expiresAt: number }
const cache = new Map<string, Entry>()

export function getCachedNews(url: string): string | undefined {
  const e = cache.get(url)
  if (!e) return undefined
  if (Date.now() > e.expiresAt) { cache.delete(url); return undefined }
  return e.text
}

export function setCachedNews(url: string, text: string): void {
  cache.set(url, { text, expiresAt: Date.now() + TTL_MS })
}

export function clearNewsCache(): void { cache.clear() }
export function newsCacheSize(): number { return cache.size }
