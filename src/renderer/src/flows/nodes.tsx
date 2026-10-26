import React, { createContext, useContext, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  flowNodeLabels,
  type AgentNodeData,
  type ConditionData,
  type DelegateNodeData,
  type FlowNodeType,
  type NewsData,
  type OutputData,
  type PromptGenNodeData,
  type StepStatus,
  type TriggerData
} from '@shared/flows'
import { describeSchedule } from '@shared/schedule'
import { MIN_PROMPT_CHARS, type Agent } from '@shared/types'
import type { RFNode } from './convert'

export interface FlowView {
  agents: Agent[]
  statuses: Record<string, StepStatus>
  nodeProblems: Record<string, string>
}

export const FlowViewContext = createContext<FlowView>({ agents: [], statuses: {}, nodeProblems: {} })

const statusLabels: Record<StepStatus, string> = {
  running: 'rodando',
  success: 'ok',
  error: 'erro',
  skipped: 'ignorado'
}

// SVG icons — outline, viewBox 16×16, stroke="currentColor"
function IconTrigger() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 2 L5 8 h4 L6 14 L13 7 h-4 Z" />
    </svg>
  )
}

function IconNews() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 2.5 h8 v11 H4 a1.5 1.5 0 0 1 -1.5 -1.5 Z" />
      <path d="M11 6 h2.5 v6 a1.5 1.5 0 0 1 -1.5 1.5" />
      <path d="M5 5 h4 M5 8 h4 M5 11 h2.5" />
    </svg>
  )
}

function IconPromptGen() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 2.5 h7 l3 3 v8 H3 Z" />
      <path d="M5.5 8 h5 M5.5 10.5 h3.5" />
      <path d="M12.5 1 v2 M11.5 2 h2" />
    </svg>
  )
}

function IconAgent() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="6" r="3.5" />
      <path d="M2 14 c0-3.3 2.7-5 6-5 s6 1.7 6 5" />
    </svg>
  )
}

function IconCondition() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 1 L15 8 L8 15 L1 8 Z" />
    </svg>
  )
}

function IconOutput() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="12" height="9" rx="1.5" />
      <path d="M8 12 v3 M5 15 h6" />
    </svg>
  )
}

function IconMemory() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="8" cy="5" rx="5" ry="2.5" />
      <path d="M3 5 v6 c0 1.4 2.2 2.5 5 2.5 s5-1.1 5-2.5 V5" />
      <path d="M3 8 c0 1.4 2.2 2.5 5 2.5 s5-1.1 5-2.5" />
    </svg>
  )
}

function IconDelegate() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 8 h8 M7 5 l3 3 -3 3" />
      <circle cx="13" cy="8" r="2" />
    </svg>
  )
}

function IconCode() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4 L1.5 8 L5 12 M11 4 L14.5 8 L11 12" />
    </svg>
  )
}

const NodeIcons: Record<FlowNodeType, () => React.ReactElement> = {
  trigger: IconTrigger,
  news: IconNews,
  promptgen: IconPromptGen,
  agent: IconAgent,
  condition: IconCondition,
  output: IconOutput,
  memory: IconMemory,
  delegate: IconDelegate,
  'mcp-tool': IconCode,
  'claude-code': IconCode
}

function Shell({ id, type, selected, children }: { id: string; type: FlowNodeType; selected: boolean; children: ReactNode }) {
  const { statuses, nodeProblems } = useContext(FlowViewContext)
  const status = statuses[id]
  const problem = nodeProblems[id]
  const Icon = NodeIcons[type]
  return (
    <div
      className={`fnode fnode-${type} status-${status ?? 'idle'} ${selected ? 'is-selected' : ''} ${problem ? 'fnode-invalid' : ''}`}
      data-node-id={id}
      title={problem}
    >
      <div className="fnode-head">
        <span className="fnode-kind">
          <Icon />
        </span>
        <span className="fnode-title">{flowNodeLabels[type]}</span>
        {status && <span className="fnode-status">{statusLabels[status]}</span>}
      </div>
      <div className="fnode-body">{children}</div>
    </div>
  )
}

const preview = (text: string, max = 70) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function TriggerNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as TriggerData
  return (
    <Shell id={id} type="trigger" selected={selected}>
      <div className="fnode-line strong">{cfg.mode === 'manual' ? 'Manual (Rodar agora)' : describeSchedule(cfg.cron)}</div>
      {cfg.input && <div className="fnode-line muted">"{preview(cfg.input, 50)}"</div>}
      <Handle type="source" position={Position.Right} className="fhandle" />
    </Shell>
  )
}

function NewsNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as NewsData
  return (
    <Shell id={id} type="news" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      <div className="fnode-line strong">
        {cfg.topic.trim() ? `"${preview(cfg.topic, 34)}"` : <span className="warn-text">informe o tema</span>}
      </div>
      <div className="fnode-line muted">
        Google Notícias · {cfg.count} {cfg.count === 1 ? 'item' : 'itens'} · {cfg.language}
      </div>
      <Handle type="source" position={Position.Right} className="fhandle" />
    </Shell>
  )
}

function PromptGenNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as PromptGenNodeData
  const agent = useContext(FlowViewContext).agents.find((a) => a.id === cfg.agentId)
  return (
    <Shell id={id} type="promptgen" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      <div className="fnode-line strong">
        {agent ? (
          <>
            <span className="dot" style={{ background: agent.color }} /> {agent.name}
          </>
        ) : (
          <span className="warn-text">escolha um agente</span>
        )}
      </div>
      <div className="fnode-line muted">ideia → corrige → prompt (mín. {MIN_PROMPT_CHARS} caracteres)</div>
      <div className="fnode-line tiny">limite {cfg.timeoutSec}s</div>
      <Handle type="source" position={Position.Right} className="fhandle" />
    </Shell>
  )
}

function AgentNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as AgentNodeData
  const agent = useContext(FlowViewContext).agents.find((a) => a.id === cfg.agentId)
  return (
    <Shell id={id} type="agent" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      <div className="fnode-line strong">
        {agent ? (
          <>
            <span className="dot" style={{ background: agent.color }} /> {agent.name}
          </>
        ) : (
          <span className="warn-text">escolha um agente</span>
        )}
      </div>
      {cfg.refinePrompt && <div className="fnode-line muted">{preview(cfg.refinePrompt)}</div>}
      <div className="fnode-line tiny">limite {cfg.timeoutSec}s</div>
      <Handle type="source" position={Position.Right} className="fhandle" />
    </Shell>
  )
}

function ConditionNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as ConditionData
  return (
    <Shell id={id} type="condition" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      <div className="fnode-line strong">
        {cfg.operator === 'contains' ? 'contém' : 'não contém'}{' '}
        {cfg.value ? `"${preview(cfg.value, 30)}"` : <span className="warn-text">…</span>}
      </div>
      <div className="fnode-branches">
        <span className="branch branch-true">Sim</span>
        <span className="branch branch-false">Não</span>
      </div>
      <Handle id="true" type="source" position={Position.Right} className="fhandle fhandle-true" style={{ top: '62%' }} />
      <Handle id="false" type="source" position={Position.Right} className="fhandle fhandle-false" style={{ top: '84%' }} />
    </Shell>
  )
}

function OutputNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as OutputData
  return (
    <Shell id={id} type="output" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      {cfg.action === 'save_md' ? (
        <>
          <div className="fnode-line strong">Salvar .md</div>
          <div className="fnode-line muted">{preview(cfg.folder || 'Documentos\\CH BOTS', 40)}</div>
        </>
      ) : (
        <>
          <div className="fnode-line strong">Notificação do Windows</div>
          {cfg.title && <div className="fnode-line muted">{preview(cfg.title, 40)}</div>}
        </>
      )}
    </Shell>
  )
}

function MemoryNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as import('@shared/flows').MemoryNodeData
  return (
    <Shell id={id} type="memory" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      <div className="fnode-line strong">{cfg.mode === 'save' ? 'Salvar na memória' : 'Buscar na memória'}</div>
      {cfg.mode === 'save' && cfg.source && <div className="fnode-line muted">fonte: {preview(cfg.source, 30)}</div>}
      {cfg.mode === 'search' && <div className="fnode-line muted">limite {cfg.limit} fatos</div>}
      <Handle type="source" position={Position.Right} className="fhandle" />
    </Shell>
  )
}

function DelegateNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as DelegateNodeData
  const agent = useContext(FlowViewContext).agents.find((a) => a.id === cfg.agentId)
  return (
    <Shell id={id} type="delegate" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      <div className="fnode-line strong">
        {agent ? (
          <>
            <span className="dot" style={{ background: agent.color }} /> {agent.name}
          </>
        ) : (
          <span className="warn-text">escolha um agente</span>
        )}
      </div>
      <div className="fnode-line tiny">limite {cfg.timeoutSec}s</div>
      <Handle type="source" position={Position.Right} className="fhandle" />
    </Shell>
  )
}

function ClaudeCodeNode({ id, data, selected }: NodeProps<RFNode>) {
  const cfg = data.cfg as import('@shared/flows').ClaudeCodeNodeData
  return (
    <Shell id={id} type="claude-code" selected={selected}>
      <Handle type="target" position={Position.Left} className="fhandle" />
      <div className="fnode-line strong">
        {cfg.pasta.trim() ? preview(cfg.pasta, 40) : <span className="warn-text">informe a pasta</span>}
      </div>
      <div className="fnode-line muted">{cfg.tarefa.trim() ? preview(cfg.tarefa, 50) : 'tarefa = entrada'}</div>
      <div className="fnode-line tiny">{cfg.modelo} · limite {cfg.timeoutSec}s</div>
      <Handle type="source" position={Position.Right} className="fhandle" />
    </Shell>
  )
}

// Fora de componentes: o React Flow exige referência estável.
export const nodeTypes = {
  trigger: TriggerNode,
  news: NewsNode,
  promptgen: PromptGenNode,
  agent: AgentNode,
  condition: ConditionNode,
  output: OutputNode,
  memory: MemoryNode,
  delegate: DelegateNode,
  'claude-code': ClaudeCodeNode
}
