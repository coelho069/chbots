import cron, { type ScheduledTask } from 'node-cron'
import { triggerOf, type FlowRun, type FlowStepEvent } from '@shared/flows'
import type { Db } from '../db/connection'
import {
  failStaleFlowRuns,
  finishFlowRun,
  finishStep,
  getFlow,
  getFlowGraph,
  insertFlowRun,
  insertStep,
  listFlows
} from '../db/repos/flows'
import type { EngineActions } from './engine'
import { runWithLangGraph, getRunState, type InterruptValue } from './langgraphRunner'
import type { SqliteCheckpointer } from './langgraphCheckpointer'

export interface FlowRunnerDeps {
  db: Db
  actionsFor: (flowName: string) => EngineActions
  checkpointer: SqliteCheckpointer
  onStep: (event: FlowStepEvent) => void
  onRunsChanged: (flowId: number) => void
  onInterrupt: (event: { runId: number; flowId: number; value: InterruptValue }) => void
  onRunFinished?: (flowName: string, run: FlowRun) => void
  schedule?: typeof cron.schedule
}

// Liga o motor LangGraph ao banco: registra a execução, cada passo e o caminho percorrido,
// e agenda os fluxos com gatilho por horário.
export class FlowRunner {
  private readonly running = new Set<number>()
  private readonly runAborts = new Map<number, AbortController>()
  // runId → função que resolve a Promise de interrupt
  private readonly pendingInterrupts = new Map<number, (approved: boolean) => void>()
  private tasks: ScheduledTask[] = []

  constructor(private readonly deps: FlowRunnerDeps) {}

  cancel(runId: number): void {
    this.runAborts.get(runId)?.abort()
    // Rejeita interrupt pendente como cancelado
    this.pendingInterrupts.get(runId)?.(false)
    this.pendingInterrupts.delete(runId)
  }

  /** Resolve um interrupt pendente; chamado pelo IPC flows:interrupt-respond */
  respondInterrupt(runId: number, approved: boolean): void {
    this.pendingInterrupts.get(runId)?.(approved)
    this.pendingInterrupts.delete(runId)
  }

  isRunning(flowId: number): boolean {
    return this.running.has(flowId)
  }

  /** Retorna o estado atual do checkpoint de uma execução */
  async status(runId: number): Promise<{ vars: Record<string, string>; ultimoResultado: string; activeNodeId: string } | null> {
    return getRunState(this.deps.checkpointer, runId.toString())
  }

  start(flowId: number, trigger: FlowRun['trigger']): { run: FlowRun; done: Promise<FlowRun> } {
    const { db, checkpointer } = this.deps
    const flow = getFlow(db, flowId)
    if (!flow) throw new Error('Fluxo não encontrado')
    if (this.running.has(flowId)) throw new Error('Este fluxo já está em execução')

    const graph = getFlowGraph(db, flowId)
    const run = insertFlowRun(db, flowId, trigger)
    this.running.add(flowId)
    this.deps.onRunsChanged(flowId)

    const abortController = new AbortController()
    this.runAborts.set(run.id, abortController)

    const stepIds = new Map<string, number>()
    const successPath: string[] = []
    const done = runWithLangGraph(graph, {
      flowName: flow.name,
      threadId: run.id.toString(),
      actions: this.deps.actionsFor(flow.name),
      checkpointer,
      cancelSignal: abortController.signal,
      onStep: (u) => {
        if (u.status === 'success') successPath.push(u.nodeId)
        const existing = stepIds.get(u.nodeId)
        const step =
          existing === undefined
            ? insertStep(db, run.id, u.nodeId, u.status, u.input)
            : finishStep(db, existing, u.status, u.output, u.error)
        stepIds.set(u.nodeId, step.id)
        this.deps.onStep({ flowId, runId: run.id, step })
      },
      onInterrupt: (value) =>
        new Promise<boolean>((resolve) => {
          this.pendingInterrupts.set(run.id, resolve)
          this.deps.onInterrupt({ runId: run.id, flowId, value })
        })
    })
      .then((r) => finishFlowRun(db, run.id, r.status, successPath, r.error))
      .catch((err: unknown) => finishFlowRun(db, run.id, 'error', [], err instanceof Error ? err.message : String(err)))
      .then((finished) => { this.deps.onRunFinished?.(flow.name, finished); return finished })
      .finally(() => {
        this.running.delete(flowId)
        this.runAborts.delete(run.id)
        this.pendingInterrupts.delete(run.id)
        this.deps.onRunsChanged(flowId)
      })

    return { run, done }
  }

  startScheduling(): void {
    failStaleFlowRuns(this.deps.db)
    this.reload()
  }

  reload(): void {
    this.stop()
    const schedule = this.deps.schedule ?? cron.schedule
    for (const flow of listFlows(this.deps.db)) {
      if (flow.schedule === null || !cron.validate(flow.schedule)) continue
      const trigger = triggerOf(getFlowGraph(this.deps.db, flow.id))
      if (trigger?.data.mode !== 'schedule') continue
      this.tasks.push(
        schedule(
          flow.schedule,
          async () => {
            // se ainda estiver rodando da vez anterior, pula este disparo
            if (this.running.has(flow.id)) return
            await this.start(flow.id, 'schedule').done
          },
          { name: `flow-${flow.id}`, noOverlap: true }
        )
      )
    }
  }

  stop(): void {
    for (const task of this.tasks) void task.destroy()
    this.tasks = []
  }

  get scheduledCount(): number {
    return this.tasks.length
  }
}
