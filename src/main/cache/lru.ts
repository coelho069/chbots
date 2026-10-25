// LRU cache usando Map — a ordem de inserção é preservada; o mais antigo fica no início.
export class LruCache<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly max: number = 500) {}

  get(key: K): V | undefined {
    const val = this.map.get(key)
    if (val === undefined) return undefined
    // Reinsere no final (mais recente)
    this.map.delete(key)
    this.map.set(key, val)
    return val
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!)
    this.map.set(key, val)
  }

  delete(key: K): void { this.map.delete(key) }
  clear(): void { this.map.clear() }
  get size(): number { return this.map.size }
}
