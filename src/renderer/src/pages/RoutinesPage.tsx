import { useCallback, useEffect, useState } from 'react'
import { cronToSchedule, describeSchedule, scheduleToCron, weekdayLabels, type Schedule } from '@shared/schedule'
import type { Agent, Routine, RoutineInput } from '@shared/types'
import { api, formatDateTime } from '../api'
import { CloseButton, useCloseHandler } from '../CloseContext'
import { confirmUnsaved, sameFields } from '../closeCurrent'
import { useToast } from '../toast'

interface Props {
  agents: Agent[]
  onGoRuns: () => void
}

interface FormState extends Omit<RoutineInput, 'cron'> {
  schedule: Schedule
}

const emptyForm = (agents: Agent[]): FormState => ({
  name: '',
  schedule: { kind: 'daily', hour: 8, minute: 0 },
  sourceAgentId: agents[0]?.id ?? 0,
  taskPrompt: '',
  targetAgentId: null,
  handoffPrompt: null,
  enabled: true,
  notifyOnlyWhenChanged: false
})

const toForm = (r: Routine): FormState => ({
  name: r.name,
  schedule: cronToSchedule(r.cron),
  sourceAgentId: r.sourceAgentId,
  taskPrompt: r.taskPrompt,
  targetAgentId: r.targetAgentId,
  handoffPrompt: r.handoffPrompt,
  enabled: r.enabled,
  notifyOnlyWhenChanged: r.notifyOnlyWhenChanged
})

const routineFields: (keyof FormState)[] = [
  'name',
  'schedule',
  'sourceAgentId',
  'taskPrompt',
  'targetAgentId',
  'handoffPrompt',
  'enabled',
  'notifyOnlyWhenChanged'
]

const pad = (n: number) => String(n).padStart(2, '0')

export function RoutinesPage({ agents, onGoRuns }: Props) {
  const toast = useToast()
  const [routines, setRoutines] = useState<Routine[]>([])
  const [selectedId, setSelectedId] = useState<number | 'new'>('new')
  const [form, setForm] = useState<FormState>(() => emptyForm(agents))
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => setRoutines(await api.routines.list()), [])

  useEffect(() => {
    load().catch(toast.error)
    return api.routines.onRunsChanged(() => void load().catch(() => undefined))
  }, [load, toast.error])

  function select(id: number | 'new') {
    setSelectedId(id)
    const r = routines.find((x) => x.id === id)
    setForm(r ? toForm(r) : emptyForm(agents))
  }

  // Ctrl+B: fecha a rotina em edição; no formulário de nova rotina não há item aberto (volta ao início).
  useCloseHandler(async () => {
    const routine = selectedId === 'new' ? undefined : routines.find((r) => r.id === selectedId)
    const baseline = routine ? toForm(routine) : emptyForm(agents)
    if (!sameFields(form, baseline, routineFields)) {
      const detail = routine ? `A rotina "${routine.name}" tem alterações não salvas.` : 'A nova rotina ainda não foi salva.'
      if (!(await confirmUnsaved(api.app.askUnsaved, detail, save))) return 'cancelled'
    }
    if (!routine) return 'nothing'
    select('new')
    return 'closed'
  })

  if (agents.length === 0) {
    return (
      <div className="page empty-state">
        <h2>Nenhum agente</h2>
        <p>Rotinas disparam um agente. Crie um agente primeiro.</p>
      </div>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const agentName = (id: number | null) => agents.find((a) => a.id === id)?.name ?? '—'

  async function save(): Promise<boolean> {
    const { schedule, ...rest } = form
    const input: RoutineInput = {
      ...rest,
      cron: scheduleToCron(schedule),
      handoffPrompt: form.targetAgentId === null ? null : (form.handoffPrompt ?? '')
    }
    setSaving(true)
    try {
      const saved = selectedId === 'new' ? await api.routines.create(input) : await api.routines.update(selectedId, input)
      await load()
      setSelectedId(saved.id)
      setForm(toForm(saved))
      toast.info('Rotina salva')
      return true
    } catch (err) {
      toast.error(err)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('Excluir esta rotina e seu histórico de execuções?')) return
    try {
      await api.routines.remove(id)
      await load()
      select('new')
    } catch (err) {
      toast.error(err)
    }
  }

  async function runNow(id: number) {
    try {
      await api.routines.runNow(id)
      toast.info('Rotina disparada. Acompanhe em Execuções.')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="page split">
      <aside className="list-pane">
        <div className="pane-header">
          <h2>Rotinas</h2>
          <button onClick={() => select('new')}>+ Nova</button>
        </div>
        <ul className="item-list">
          {routines.map((r) => (
            <li key={r.id}>
              <button className={`item ${selectedId === r.id ? 'active' : ''}`} onClick={() => select(r.id)}>
                <span className="item-title">
                  {r.name} {!r.enabled && <span className="tag">pausada</span>}
                </span>
                <span className="item-sub">{describeSchedule(r.cron)}</span>
                <span className="item-sub">
                  {agentName(r.sourceAgentId)}
                  {r.targetAgentId !== null && ` → ${agentName(r.targetAgentId)}`}
                </span>
              </button>
            </li>
          ))}
          {routines.length === 0 && <li className="muted pad">Nenhuma rotina ainda.</li>}
        </ul>
      </aside>

      <section className="detail-pane">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="row-between">
            <h2>{selectedId === 'new' ? 'Nova rotina' : 'Editar rotina'}</h2>
            {selectedId !== 'new' && <CloseButton label="Fechar rotina" />}
          </div>

          <label>
            Nome
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
          </label>

          <ScheduleEditor value={form.schedule} onChange={(s) => set('schedule', s)} />

          <label>
            Agente que executa
            <select value={form.sourceAgentId} onChange={(e) => set('sourceAgentId', Number(e.target.value))}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Tarefa
            <textarea
              rows={5}
              value={form.taskPrompt}
              onChange={(e) => set('taskPrompt', e.target.value)}
              required
              placeholder="O que o agente deve fazer a cada disparo"
            />
          </label>

          <label>
            Enviar a resposta para
            <select
              value={form.targetAgentId ?? ''}
              onChange={(e) => set('targetAgentId', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Ninguém (só guardar)</option>
              {agents
                .filter((a) => a.id !== form.sourceAgentId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>

          {form.targetAgentId !== null && (
            <label>
              Instrução para o destino
              <textarea
                rows={3}
                value={form.handoffPrompt ?? ''}
                onChange={(e) => set('handoffPrompt', e.target.value)}
                placeholder="ex.: Transforme isto em um resumo de 5 tópicos"
              />
            </label>
          )}

          <label className="check">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Ativa
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={form.notifyOnlyWhenChanged ?? false}
              onChange={(e) => set('notifyOnlyWhenChanged', e.target.checked)}
            />
            {' '}Avisar só se o resultado mudar
          </label>

          {selectedId !== 'new' && (
            <p className="muted">
              Última execução:{' '}
              {routines.find((r) => r.id === selectedId)?.lastRunAt
                ? formatDateTime(routines.find((r) => r.id === selectedId)!.lastRunAt!)
                : 'nunca'}
            </p>
          )}

          <div className="actions">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            {selectedId !== 'new' && (
              <>
                <button type="button" onClick={() => void runNow(selectedId)}>
                  Rodar agora
                </button>
                <button type="button" onClick={onGoRuns}>
                  Ver execuções
                </button>
                <button type="button" className="danger" onClick={() => void remove(selectedId)}>
                  Excluir
                </button>
              </>
            )}
          </div>
          <p className="muted small">As rotinas só disparam com o CH BOTS aberto (pode estar na bandeja).</p>
        </form>
      </section>
    </div>
  )
}

function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const time = 'hour' in value ? `${pad(value.hour)}:${pad(value.minute)}` : '08:00'
  const parseTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return { hour: h ?? 0, minute: m ?? 0 }
  }

  function changeKind(kind: Schedule['kind']) {
    const { hour, minute } = parseTime(time)
    if (kind === 'interval') onChange({ kind, minutes: 30 })
    else if (kind === 'daily') onChange({ kind, hour, minute })
    else if (kind === 'weekly') onChange({ kind, hour, minute, days: [1, 2, 3, 4, 5] })
    else onChange({ kind, cron: scheduleToCron(value) })
  }

  return (
    <div className="field">
      <span>Quando</span>
      <div className="row">
        <select value={value.kind} onChange={(e) => changeKind(e.target.value as Schedule['kind'])}>
          <option value="daily">Todo dia</option>
          <option value="weekly">Dias da semana</option>
          <option value="interval">A cada N minutos</option>
          <option value="custom">Expressão cron</option>
        </select>

        {value.kind === 'interval' && (
          <input
            type="number"
            min={1}
            max={59}
            value={value.minutes}
            onChange={(e) => onChange({ kind: 'interval', minutes: Math.min(59, Math.max(1, Number(e.target.value))) })}
          />
        )}

        {(value.kind === 'daily' || value.kind === 'weekly') && (
          <input type="time" value={time} required onChange={(e) => onChange({ ...value, ...parseTime(e.target.value) })} />
        )}

        {value.kind === 'custom' && (
          <input
            className="grow mono"
            value={value.cron}
            onChange={(e) => onChange({ kind: 'custom', cron: e.target.value })}
            placeholder="min hora dia mês dia-da-semana"
          />
        )}
      </div>

      {value.kind === 'weekly' && (
        <div className="weekdays">
          {weekdayLabels.map((label, day) => {
            const on = value.days.includes(day)
            return (
              <button
                type="button"
                key={day}
                className={`chip ${on ? 'active' : ''}`}
                onClick={() =>
                  onChange({ ...value, days: on ? value.days.filter((d) => d !== day) : [...value.days, day] })
                }
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
      <span className="muted small">{describeSchedule(scheduleToCron(value))}</span>
    </div>
  )
}
