import {
  MAX_NEWS_COUNT,
  flowNodeLabels,
  newsLanguageCodes,
  newsLanguages,
  type AgentNodeData,
  type ConditionData,
  type DelegateNodeData,
  type FlowNodeDataMap,
  type FlowNodeType,
  type MemoryNodeData,
  type NewsData,
  type NewsLanguage,
  type OutputData,
  type PromptGenNodeData,
  type TriggerData
} from '@shared/flows'
import { describeSchedule } from '@shared/schedule'
import { MIN_PROMPT_CHARS, type Agent } from '@shared/types'
import type { RFNode } from './convert'

interface Props {
  node: RFNode
  agents: Agent[]
  onChange: (patch: Partial<FlowNodeDataMap[FlowNodeType]>) => void
  onDelete: () => void
}

const clampTimeout = (v: number) => Math.min(600, Math.max(5, Math.round(v) || 5))

export function Inspector({ node, agents, onChange, onDelete }: Props) {
  return (
    <div className="inspector form">
      <h3>{flowNodeLabels[node.type]}</h3>
      {node.type === 'trigger' && <TriggerForm cfg={node.data.cfg as TriggerData} onChange={onChange} />}
      {node.type === 'news' && <NewsForm cfg={node.data.cfg as NewsData} onChange={onChange} />}
      {node.type === 'promptgen' && <PromptGenForm cfg={node.data.cfg as PromptGenNodeData} agents={agents} onChange={onChange} />}
      {node.type === 'agent' && <AgentForm cfg={node.data.cfg as AgentNodeData} agents={agents} onChange={onChange} />}
      {node.type === 'condition' && <ConditionForm cfg={node.data.cfg as ConditionData} onChange={onChange} />}
      {node.type === 'output' && <OutputForm cfg={node.data.cfg as OutputData} onChange={onChange} />}
      {node.type === 'memory' && <MemoryForm cfg={node.data.cfg as MemoryNodeData} onChange={onChange} />}
      {node.type === 'delegate' && <DelegateForm cfg={node.data.cfg as DelegateNodeData} agents={agents} onChange={onChange} />}
      {node.type !== 'trigger' && (
        <div className="actions">
          <button type="button" className="danger" onClick={onDelete}>
            Remover nó
          </button>
        </div>
      )}
    </div>
  )
}

function TriggerForm({ cfg, onChange }: { cfg: TriggerData; onChange: (p: Partial<TriggerData>) => void }) {
  return (
    <>
      <label>
        Disparo
        <select value={cfg.mode} onChange={(e) => onChange({ mode: e.target.value as TriggerData['mode'] })}>
          <option value="manual">Manual (botão Rodar agora)</option>
          <option value="schedule">Por horário (cron)</option>
        </select>
      </label>
      {cfg.mode === 'schedule' && (
        <label>
          Expressão cron
          <input className="mono" value={cfg.cron} onChange={(e) => onChange({ cron: e.target.value })} placeholder="0 8 * * 1-5" />
          <span className="muted small">
            {cfg.cron.trim().split(/\s+/).length === 5 ? describeSchedule(cfg.cron) : 'min hora dia mês dia-da-semana'}
          </span>
        </label>
      )}
      <label>
        Texto inicial (opcional)
        <textarea
          rows={4}
          value={cfg.input}
          onChange={(e) => onChange({ input: e.target.value })}
          placeholder="Vira a entrada do primeiro nó"
        />
      </label>
      <p className="muted small">Mesmo com horário, o botão Rodar agora também dispara o fluxo.</p>
    </>
  )
}

function NewsForm({ cfg, onChange }: { cfg: NewsData; onChange: (p: Partial<NewsData>) => void }) {
  return (
    <>
      <label>
        Tema
        <input value={cfg.topic} maxLength={200} onChange={(e) => onChange({ topic: e.target.value })} placeholder="ex.: inteligência artificial" />
      </label>
      <label>
        Idioma
        <select value={cfg.language} onChange={(e) => onChange({ language: e.target.value as NewsLanguage })}>
          {newsLanguageCodes.map((code) => (
            <option key={code} value={code}>
              {newsLanguages[code].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantidade de notícias
        <input
          type="number"
          min={1}
          max={MAX_NEWS_COUNT}
          value={cfg.count}
          onChange={(e) => onChange({ count: Math.min(MAX_NEWS_COUNT, Math.max(1, Math.round(Number(e.target.value)) || 1)) })}
        />
      </label>
      <p className="muted small">
        Busca no RSS do Google Notícias. A saída é uma lista com título, fonte, data e link de cada notícia. Precisa de
        internet; tempo limite de {cfg.timeoutSec}s. A entrada recebida é ignorada.
      </p>
    </>
  )
}

function PromptGenForm({
  cfg,
  agents,
  onChange
}: {
  cfg: PromptGenNodeData
  agents: Agent[]
  onChange: (p: Partial<PromptGenNodeData>) => void
}) {
  return (
    <>
      <label>
        Agente que gera
        <select value={cfg.agentId ?? ''} onChange={(e) => onChange({ agentId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Escolha…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.model})
            </option>
          ))}
        </select>
        <span className="muted small">Usa o provedor e o modelo deste agente, não o prompt de sistema dele.</span>
      </label>
      <label>
        Tempo limite do nó (segundos)
        <input
          type="number"
          min={5}
          max={600}
          value={cfg.timeoutSec}
          onChange={(e) => onChange({ timeoutSec: clampTimeout(Number(e.target.value)) })}
        />
        <span className="muted small">Cada chamada ao modelo tem até 60 s; o nó faz de 2 a 4 chamadas.</span>
      </label>
      <p className="muted small">
        A entrada é a ideia. O nó corrige o texto, gera um prompt com no mínimo {MIN_PROMPT_CHARS} caracteres (pede
        expansão até 2 vezes) e entrega o prompt como saída. Cada geração também fica no histórico da tela Gerador de
        Prompts.
      </p>
    </>
  )
}

function AgentForm({ cfg, agents, onChange }: { cfg: AgentNodeData; agents: Agent[]; onChange: (p: Partial<AgentNodeData>) => void }) {
  return (
    <>
      <label>
        Agente
        <select value={cfg.agentId ?? ''} onChange={(e) => onChange({ agentId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Escolha…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prompt de refinamento
        <textarea
          rows={6}
          value={cfg.refinePrompt}
          onChange={(e) => onChange({ refinePrompt: e.target.value })}
          placeholder="O que o agente deve fazer com a entrada recebida"
        />
        <span className="muted small">
          Use <code>{'{{entrada}}'}</code> para posicionar a entrada no prompt; sem ela, a entrada é anexada abaixo.
        </span>
      </label>
      <details>
        <summary className="muted small">Opções avançadas</summary>
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.includeAllInputs ?? false}
            onChange={(e) => onChange({ includeAllInputs: e.target.checked })}
          />
          Incluir saídas anteriores (quando há múltiplas entradas)
        </label>
      </details>
      <label>
        Tempo limite (segundos)
        <input
          type="number"
          min={5}
          max={600}
          value={cfg.timeoutSec}
          onChange={(e) => onChange({ timeoutSec: clampTimeout(Number(e.target.value)) })}
        />
      </label>
    </>
  )
}

function ConditionForm({ cfg, onChange }: { cfg: ConditionData; onChange: (p: Partial<ConditionData>) => void }) {
  return (
    <>
      <label>
        A entrada…
        <select value={cfg.operator} onChange={(e) => onChange({ operator: e.target.value as ConditionData['operator'] })}>
          <option value="contains">contém</option>
          <option value="not_contains">não contém</option>
        </select>
      </label>
      <label>
        Texto
        <input value={cfg.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="ex.: APROVADO" />
      </label>
      <label className="check">
        <input type="checkbox" checked={cfg.caseSensitive} onChange={(e) => onChange({ caseSensitive: e.target.checked })} />
        Diferenciar maiúsculas de minúsculas
      </label>
      <p className="muted small">Ligue a saída “Sim” ou “Não” ao próximo nó. A entrada passa adiante sem mudanças.</p>
    </>
  )
}

function MemoryForm({ cfg, onChange }: { cfg: MemoryNodeData; onChange: (p: Partial<MemoryNodeData>) => void }) {
  return (
    <>
      <label>
        Modo
        <select value={cfg.mode} onChange={(e) => onChange({ mode: e.target.value as MemoryNodeData['mode'] })}>
          <option value="save">Salvar fatos da entrada na memória</option>
          <option value="search">Buscar fatos relevantes (injeta no próximo nó)</option>
        </select>
      </label>
      {cfg.mode === 'save' && (
        <label>
          Fonte (obrigatória)
          <input value={cfg.source} onChange={(e) => onChange({ source: e.target.value })} placeholder="ex.: fluxo de análise" />
        </label>
      )}
      {cfg.mode === 'search' && (
        <label>
          Limite de fatos
          <input type="number" min={1} max={50} value={cfg.limit} onChange={(e) => onChange({ limit: Math.max(1, Math.min(50, +e.target.value)) })} />
        </label>
      )}
      <label>
        Tempo limite (segundos)
        <input type="number" min={5} max={600} value={cfg.timeoutSec} onChange={(e) => onChange({ timeoutSec: clampTimeout(Number(e.target.value)) })} />
      </label>
    </>
  )
}

function DelegateForm({ cfg, agents, onChange }: { cfg: DelegateNodeData; agents: Agent[]; onChange: (p: Partial<DelegateNodeData>) => void }) {
  return (
    <>
      <label>
        Agente destino
        <select value={cfg.agentId ?? ''} onChange={(e) => onChange({ agentId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Escolha…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <span className="muted small">A entrada deste nó vira a tarefa delegada. A resposta segue adiante no fluxo.</span>
      </label>
      <label>
        Tempo limite (segundos)
        <input type="number" min={5} max={600} value={cfg.timeoutSec} onChange={(e) => onChange({ timeoutSec: clampTimeout(Number(e.target.value)) })} />
      </label>
    </>
  )
}

function OutputForm({ cfg, onChange }: { cfg: OutputData; onChange: (p: Partial<OutputData>) => void }) {
  return (
    <>
      <label>
        Ação
        <select value={cfg.action} onChange={(e) => onChange({ action: e.target.value as OutputData['action'] })}>
          <option value="save_md">Salvar arquivo .md</option>
          <option value="notify">Notificação do Windows</option>
        </select>
      </label>
      {cfg.action === 'save_md' ? (
        <>
          <label>
            Pasta
            <input
              className="mono"
              value={cfg.folder}
              onChange={(e) => onChange({ folder: e.target.value })}
              placeholder="vazio = Documentos\CH BOTS"
            />
          </label>
          <label>
            Nome do arquivo
            <input className="mono" value={cfg.fileName} onChange={(e) => onChange({ fileName: e.target.value })} />
            <span className="muted small">Use {'{fluxo}'} e {'{data}'}. Nunca sobrescreve: acrescenta -2, -3…</span>
          </label>
        </>
      ) : (
        <label>
          Título da notificação
          <input value={cfg.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="vazio = nome do fluxo" />
        </label>
      )}
      <label>
        Tempo limite (segundos)
        <input
          type="number"
          min={5}
          max={600}
          value={cfg.timeoutSec}
          onChange={(e) => onChange({ timeoutSec: clampTimeout(Number(e.target.value)) })}
        />
      </label>
    </>
  )
}
