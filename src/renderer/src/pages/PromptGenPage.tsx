import { useCallback, useEffect, useState } from 'react'
import {
  MAX_PROMPT_EXPANSIONS,
  MIN_PROMPT_CHARS,
  type Agent,
  type AgentInput,
  type GeneratedPrompt
} from '@shared/types'
import { api, errorMessage, formatDateTime } from '../api'
import { CloseButton, useCloseHandler } from '../CloseContext'
import { confirmUnsaved } from '../closeCurrent'
import { useToast } from '../toast'

export type AgentDraft = Pick<AgentInput, 'name' | 'systemPrompt' | 'providerId' | 'model'>

interface Props {
  agents: Agent[]
  onCreateAgent: (draft: AgentDraft) => void
  onGoAgents: () => void
}

type Phase = 'idle' | 'correcting' | 'generating'

// Igual à contagem do main: acentos e emoji contam 1.
const countChars = (text: string) => [...text].length

const oneLine = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function PromptGenPage({ agents, onCreateAgent, onGoAgents }: Props) {
  const toast = useToast()
  const [idea, setIdea] = useState('')
  const [agentId, setAgentId] = useState<number | null>(agents[0]?.id ?? null)
  const [corrected, setCorrected] = useState('')
  const [prompt, setPrompt] = useState('')
  // versão que está no histórico, para saber se o campo foi editado
  const [savedPrompt, setSavedPrompt] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [expansions, setExpansions] = useState<number | null>(null)
  const [history, setHistory] = useState<GeneratedPrompt[]>([])

  const loadHistory = useCallback(async () => setHistory(await api.prompts.list()), [])

  useEffect(() => {
    loadHistory().catch(toast.error)
  }, [loadHistory, toast.error])

  useEffect(() => {
    if (agentId === null || !agents.some((a) => a.id === agentId)) setAgentId(agents[0]?.id ?? null)
  }, [agents, agentId])

  // Ctrl+B: limpa a tela. O que foi gerado já está no histórico; só pergunta se há texto que não está lá.
  useCloseHandler(async () => {
    if (phase !== 'idle') {
      toast.info('Aguarde a geração terminar para fechar.')
      return 'cancelled'
    }
    if (!idea.trim() && !corrected.trim() && !prompt.trim()) return 'nothing'
    const unsaved =
      prompt && prompt !== savedPrompt
        ? 'O prompt foi editado e as edições não estão no histórico.'
        : !prompt && idea.trim()
          ? 'A ideia digitada ainda não foi gerada.'
          : null
    if (unsaved && !(await confirmUnsaved(api.app.askUnsaved, unsaved))) return 'cancelled'
    setIdea('')
    setCorrected('')
    setPrompt('')
    setSavedPrompt('')
    setExpansions(null)
    setError(null)
    return 'closed'
  })

  if (agents.length === 0) {
    return (
      <div className="page empty-state">
        <h2>Gerador de Prompts</h2>
        <p>O gerador usa o modelo de um agente. Crie um agente antes de começar.</p>
        <button className="primary" onClick={onGoAgents}>
          Ir para Agentes
        </button>
      </div>
    )
  }

  const busy = phase !== 'idle'
  const chars = countChars(prompt)
  const agentOf = (id: number | null) => agents.find((a) => a.id === id)

  async function generateFrom(correctedIdea: string) {
    setPhase('generating')
    const res = await api.prompts.generate({ agentId: agentId!, originalIdea: idea.trim() || correctedIdea, correctedIdea })
    setPrompt(res.record.prompt)
    setSavedPrompt(res.record.prompt)
    setExpansions(res.expansions)
    void loadHistory().catch(() => undefined)
  }

  async function run(task: () => Promise<void>) {
    if (agentId === null) return
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPhase('idle')
    }
  }

  const generateAll = () =>
    run(async () => {
      setPhase('correcting')
      setPrompt('')
      setExpansions(null)
      const fixed = await api.prompts.correct(agentId!, idea)
      setCorrected(fixed)
      await generateFrom(fixed)
    })

  const regenerate = () => run(() => generateFrom(corrected))

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      toast.info('Prompt copiado')
    } catch (err) {
      toast.error(err)
    }
  }

  async function saveMd() {
    try {
      const file = await api.prompts.saveMarkdown(prompt, `prompt-${new Date().toISOString().slice(0, 10)}`)
      if (file) toast.info(`Salvo em ${file}`)
    } catch (err) {
      toast.error(err)
    }
  }

  function createAgent() {
    const base = agentOf(agentId) ?? agents[0]!
    onCreateAgent({
      name: oneLine(corrected || idea, 60) || 'Agente gerado',
      systemPrompt: prompt,
      providerId: base.providerId,
      model: base.model
    })
  }

  function openRecord(r: GeneratedPrompt) {
    setIdea(r.originalIdea)
    setCorrected(r.correctedIdea)
    setPrompt(r.prompt)
    setSavedPrompt(r.prompt)
    setExpansions(null)
    setError(null)
    if (r.agentId !== null && agents.some((a) => a.id === r.agentId)) setAgentId(r.agentId)
    document.querySelector('.promptgen-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function removeRecord(r: GeneratedPrompt) {
    if (!confirm('Apagar este prompt do histórico?')) return
    try {
      await api.prompts.remove(r.id)
      await loadHistory()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="page promptgen">
      <div className="form promptgen-form">
        <div className="row-between">
          <h2>Gerador de Prompts</h2>
          {(idea || corrected || prompt) && !busy && <CloseButton label="Fechar e limpar" />}
        </div>
        <p className="muted small">
          Escreva a ideia do seu jeito. O modelo corrige o texto e depois o transforma num prompt profissional com no
          mínimo {MIN_PROMPT_CHARS} caracteres.
        </p>

        <label>
          Sua ideia
          <textarea
            rows={6}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="ex.: quero um asistente que ajude a montar cardapio semanal saudavel pra familia com criança"
            disabled={busy}
          />
        </label>

        <div className="row">
          <label className="grow">
            Agente / modelo que vai gerar
            <select value={agentId ?? ''} onChange={(e) => setAgentId(Number(e.target.value))} disabled={busy}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.model}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => void generateAll()} disabled={busy || !idea.trim()}>
            Gerar prompt
          </button>
        </div>
        <span className="muted small">Usa o provedor e o modelo do agente; o prompt de sistema dele não entra.</span>

        {busy && (
          <div className="busy-line" role="status">
            <span className="spinner" aria-hidden />
            {phase === 'correcting'
              ? 'Corrigindo…'
              : `Gerando… (se ficar curto, o modelo é chamado de novo até ${MAX_PROMPT_EXPANSIONS} vezes)`}
          </div>
        )}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}

        {(corrected || phase === 'correcting') && (
          <label>
            Ideia corrigida
            <textarea rows={4} value={corrected} onChange={(e) => setCorrected(e.target.value)} disabled={busy} />
            <span className="muted small">Pode editar; "Gerar de novo" usa este texto.</span>
          </label>
        )}

        {prompt && (
          <div className="field promptgen-result">
            <div className="row-between">
              <span>Prompt gerado</span>
              <span className={`char-count ${chars >= MIN_PROMPT_CHARS ? 'ok' : 'short'}`}>
                {chars.toLocaleString('pt-BR')} caracteres
              </span>
            </div>
            <textarea rows={20} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} />
            {chars < MIN_PROMPT_CHARS && (
              <div className="warn-box" role="status">
                O prompt tem {chars.toLocaleString('pt-BR')} caracteres, abaixo do mínimo de{' '}
                {MIN_PROMPT_CHARS.toLocaleString('pt-BR')}
                {expansions === MAX_PROMPT_EXPANSIONS ? `, mesmo depois de ${MAX_PROMPT_EXPANSIONS} pedidos de expansão` : ''}.
                Tente "Gerar de novo", detalhe mais a ideia ou use um modelo maior.
              </div>
            )}
            {expansions !== null && expansions > 0 && chars >= MIN_PROMPT_CHARS && (
              <span className="muted small">
                O modelo precisou expandir {expansions} {expansions === 1 ? 'vez' : 'vezes'} para chegar ao mínimo.
              </span>
            )}
            <div className="actions">
              <button onClick={() => void copy()} disabled={busy}>
                Copiar
              </button>
              <button onClick={() => void saveMd()} disabled={busy}>
                Salvar como .md
              </button>
              <button onClick={createAgent} disabled={busy}>
                Criar agente com este prompt
              </button>
              <button onClick={() => void regenerate()} disabled={busy || !corrected.trim()}>
                Gerar de novo
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="promptgen-history">
        <h3>Histórico</h3>
        {history.length === 0 ? (
          <p className="muted">Nenhum prompt gerado ainda.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Ideia</th>
                <th>Caracteres</th>
                <th>Agente</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td title={r.correctedIdea}>{oneLine(r.correctedIdea, 70)}</td>
                  <td className={r.chars < MIN_PROMPT_CHARS ? 'warn-text-strong' : ''}>{r.chars.toLocaleString('pt-BR')}</td>
                  <td>{agentOf(r.agentId)?.name ?? <span className="muted">excluído</span>}</td>
                  <td className="links">
                    <button className="link" onClick={() => openRecord(r)} disabled={busy}>
                      abrir
                    </button>
                    <button className="link danger-link" onClick={() => void removeRecord(r)}>
                      apagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
