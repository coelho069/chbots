import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface SecretStore {
  get(ref: string): string | null
  set(ref: string, value: string): void
  delete(ref: string): void
}

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

// Guarda segredos cifrados (base64) num JSON. A cifra vem de fora: no app é o
// safeStorage do Electron (DPAPI no Windows); nos testes, uma cifra falsa.
export class FileSecretStore implements SecretStore {
  private cache: Record<string, string>

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher
  ) {
    this.cache = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>) : {}
  }

  get(ref: string): string | null {
    const stored = this.cache[ref]
    return stored === undefined ? null : this.cipher.decrypt(Buffer.from(stored, 'base64'))
  }

  set(ref: string, value: string): void {
    this.cache[ref] = this.cipher.encrypt(value).toString('base64')
    this.flush()
  }

  delete(ref: string): void {
    if (!(ref in this.cache)) return
    delete this.cache[ref]
    this.flush()
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()
  get(ref: string): string | null {
    return this.values.get(ref) ?? null
  }
  set(ref: string, value: string): void {
    this.values.set(ref, value)
  }
  delete(ref: string): void {
    this.values.delete(ref)
  }
}

export const providerKeyRef = (providerId: number): string => `provider:${providerId}`
