import cron, { type ScheduledTask } from 'node-cron'
import type { Routine, RoutineRun } from '@shared/types'
import type { Db } from '../db/connection'
import { insertConversation } from '../db/repos/conversations'
import { failStaleRuns, getRoutine, listRoutines, startRun, updateRun } from '../db/repos/routines'
import type { ChatService } from './chat'
import { handoff } from './handoff'

export interface SchedulerDeps {
  db: Db
  chat: ChatService
  onRunsChanged: () => void
  onRunFinished: (routine: Routine, run: RoutineRun) => void
  schedule?: typeof cron.schedule
}

export class Scheduler {
  private tasks: ScheduledTask[] = []

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    failStaleRuns(this.deps.db)
    this.reload()
  }

  // Recria os agendamentos a partir do banco; chamado após qualquer mudança em rotinas.
  reload(): void {
    this.stop()
    const schedule = this.deps.schedule ?? cron.schedule
    for (const routine of listRoutines(this.deps.db)) {
      if (!routine.enabled || !cron.validate(routine.cron)) continue
      const task = schedule(
        routine.cron,
        async () => {
          await this.trigger(routine.id).done
        },
        { name: `routine-${routine.id}`, noOverlap: true }
      )
      this.tasks.push(task)
    }
  }

  stop(): void {
    for (const task of this.tasks) void task.destroy()
    this.tasks = []
  }

  get scheduledCount(): number {
    return this.tasks.length
  }

  // Cria o registro da execução na hora e devolve a promessa do resultado final.
  trigger(routineId: number): { run: RoutineRun; done: Promise<RoutineRun> } {
    const { db } = this.deps
    const routine = getRoutine(db, routineId)
    if (!routine) throw new Error('Rotina não encontrada')
    const run = startRun(db, routine.id)
    this.deps.onRunsChanged()
    return { run, done: this.execute(routine, run) }
  }

  private async execute(routine: Routine, run: RoutineRun): Promise<RoutineRun> {
    const { db, chat } = this.deps
    let result: RoutineRun
    try {
      const stamp = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      const source = insertConversation(db, routine.sourceAgentId, 'routine', `${routine.name} · ${stamp}`)
      updateRun(db, run.id, { sourceConversationId: source.id })
      this.deps.onRunsChanged()

      const reply = await chat.send(source.id, routine.taskPrompt)

      if (routine.targetAgentId !== null) {
        const target = await handoff(db, chat, {
          fromAgentId: routine.sourceAgentId,
          toAgentId: routine.targetAgentId,
          content: reply.content,
          instruction: routine.handoffPrompt ?? '',
          origin: 'routine'
        })
        updateRun(db, run.id, { targetConversationId: target.conversationId })
      }
      result = updateRun(db, run.id, { status: 'ok' })
    } catch (err) {
      result = updateRun(db, run.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
    this.deps.onRunsChanged()
    this.deps.onRunFinished(routine, result)
    return result
  }
}
