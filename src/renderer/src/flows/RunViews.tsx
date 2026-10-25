import { useEffect, useState, type ReactNode } from 'react'
import { nodeRef, type FlowGraph, type FlowRun, type FlowRunStep } from '@shared/flows'
import { formatDateTime } from '../api'

const runStatusLabels = { running: 'Rodando', ok: 'Concluída', error: 'Erro' } as const
const stepStatusLabels = { running: 'Rodando', success: 'Sucesso', error: 'Erro', skipped: 'Ignorado' } as const

function elapsed(start: string, end: string | null): string {
  if (!end) return '…'
  const ms = Date.parse(end) - Date.parse(start)
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function RunPanel({
  runs,
  selectedRunId,
  graph,
  onSelect
}: {
  runs: FlowRun[]
  selectedRunId: number | null
  graph: FlowGraph
  onSelect: (id: number) => void
}) {
  if (runs.length === 0) return <p className="muted pad">Nenhuma execução ainda. Use “Rodar agora”.</p>
  return (
    <ul className="run-list">
      {runs.map((run) => (
        <li key={run.id}>
          <button className={`run-item ${run.id === selectedRunId ? 'active' : ''}`} onClick={() => onSelect(run.id)}>
            <span className="run-top">
              <span className={`status status-${run.status}`}>{runStatusLabels[run.status]}</span>
              <span className="muted small">{formatDateTime(run.startedAt)}</span>
              {run.trigger === 'schedule' && <span className="tag">agendada</span>}
            </span>
            {run.path.length > 0 && (
              <span className="run-path small">{run.path.map((id) => nodeRef(graph, id)).join(' → ')}</span>
            )}
            {run.error && <span className="error-text">{run.error}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button className="copy-btn" onClick={copy}>
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  )
}

export function StepModal({
  label,
  detail,
  step,
  onClose
}: {
  label: string
  // complemento do título, ex.: nome do agente
  detail: string | null
  step: FlowRunStep | undefined
  onClose: () => void
}) {
  return (
    <Modal title={detail ? `${label} · ${detail}` : label} onClose={onClose}>
      {!step ? (
        <p className="muted">Este nó não rodou nesta execução.</p>
      ) : (
        <div className="step-detail">
          <p>
            <span className={`status step-${step.status}`}>{stepStatusLabels[step.status]}</span>{' '}
            <span className="muted small">
              {formatDateTime(step.startedAt)} · {elapsed(step.startedAt, step.finishedAt)}
            </span>
          </p>
          <p className="muted small">[A FAZER] tokens: informação não disponível nesta versão</p>
          {step.error && (
            <section>
              <h4>Erro</h4>
              <pre className="payload error-text">{step.error}</pre>
            </section>
          )}
          <div className="step-cols">
            <section>
              <div className="step-col-head">
                <h4>Entrada</h4>
                <CopyButton text={step.input || ''} />
              </div>
              <pre className="payload">{step.input || '(vazia)'}</pre>
            </section>
            <section>
              <div className="step-col-head">
                <h4>Saída</h4>
                <CopyButton text={step.output ?? ''} />
              </div>
              <pre className="payload">{step.output ?? (step.status === 'running' ? '(aguardando…)' : '(nenhuma)')}</pre>
            </section>
          </div>
        </div>
      )}
    </Modal>
  )
}
