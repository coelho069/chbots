import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type ChannelVersions
} from '@langchain/langgraph'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { Db } from '../db/connection'

// Cria as tabelas se ainda não existirem (chamado antes de instanciar)
export function ensureCheckpointTables(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS flow_checkpoints (
      thread_id     TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL,
      checkpoint    TEXT NOT NULL,
      metadata      TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
    );
    CREATE TABLE IF NOT EXISTS flow_checkpoint_writes (
      thread_id     TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL,
      task_id       TEXT NOT NULL,
      idx           INTEGER NOT NULL,
      channel       TEXT NOT NULL,
      type          TEXT,
      blob          TEXT,
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
    );
  `)
}

interface CheckpointRow {
  thread_id: string
  checkpoint_ns: string
  checkpoint_id: string
  checkpoint: string
  metadata: string
}

interface WriteRow {
  task_id: string
  channel: string
  type: string | null
  blob: string | null
}

export class SqliteCheckpointer extends BaseCheckpointSaver {
  constructor(private readonly db: Db) {
    super()
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id, checkpoint_ns = '', checkpoint_id } = (config.configurable ?? {}) as Record<string, string>

    let row: CheckpointRow | undefined
    if (checkpoint_id) {
      row = this.db
        .prepare('SELECT * FROM flow_checkpoints WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=? LIMIT 1')
        .get(thread_id, checkpoint_ns, checkpoint_id) as CheckpointRow | undefined
    } else {
      row = this.db
        .prepare('SELECT * FROM flow_checkpoints WHERE thread_id=? AND checkpoint_ns=? ORDER BY checkpoint_id DESC LIMIT 1')
        .get(thread_id, checkpoint_ns) as CheckpointRow | undefined
    }

    if (!row) return undefined

    const writes = this.db
      .prepare('SELECT * FROM flow_checkpoint_writes WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=? ORDER BY idx')
      .all(row.thread_id, row.checkpoint_ns, row.checkpoint_id) as WriteRow[]

    return {
      config: { configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: row.checkpoint_id } },
      checkpoint: JSON.parse(row.checkpoint) as Checkpoint,
      metadata: JSON.parse(row.metadata) as CheckpointMetadata,
      parentConfig: undefined,
      pendingWrites: writes.map((w): PendingWrite => [w.task_id, w.channel, w.blob !== null ? JSON.parse(w.blob) : undefined])
    }
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { thread_id, checkpoint_ns = '' } = (config.configurable ?? {}) as Record<string, string>
    const limit = options?.limit ?? 100
    const rows = this.db
      .prepare('SELECT * FROM flow_checkpoints WHERE thread_id=? AND checkpoint_ns=? ORDER BY checkpoint_id DESC LIMIT ?')
      .all(thread_id, checkpoint_ns, limit) as CheckpointRow[]

    for (const row of rows) {
      yield {
        config: { configurable: { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns, checkpoint_id: row.checkpoint_id } },
        checkpoint: JSON.parse(row.checkpoint) as Checkpoint,
        metadata: JSON.parse(row.metadata) as CheckpointMetadata,
        parentConfig: undefined,
        pendingWrites: []
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const { thread_id, checkpoint_ns = '' } = (config.configurable ?? {}) as Record<string, string>
    const checkpoint_id = checkpoint.id

    this.db
      .prepare('INSERT OR REPLACE INTO flow_checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata, created_at) VALUES (?,?,?,?,?,?)')
      .run(thread_id, checkpoint_ns, checkpoint_id, JSON.stringify(checkpoint), JSON.stringify(metadata), new Date().toISOString())

    return { configurable: { thread_id, checkpoint_ns, checkpoint_id } }
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { thread_id, checkpoint_ns = '', checkpoint_id } = (config.configurable ?? {}) as Record<string, string>
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO flow_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob) VALUES (?,?,?,?,?,?,?,?)'
    )
    writes.forEach(([channel, value], idx) => {
      stmt.run(
        thread_id, checkpoint_ns, checkpoint_id, taskId, idx,
        channel as string,
        typeof value,
        value !== undefined ? JSON.stringify(value) : null
      )
    })
  }
}
