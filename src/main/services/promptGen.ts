import {
  MAX_PROMPT_EXPANSIONS,
  MIN_PROMPT_CHARS,
  PROMPT_CALL_TIMEOUT_SEC,
  type Agent,
  type PromptGenResult
} from '@shared/types'
import type { Db } from '../db/connection'
import { getAgent } from '../db/repos/agents'
import { countChars, insertGeneratedPrompt } from '../db/repos/prompts'
import type { ChatTurn, LlmClient } from '../llm/provider'

export const promptSections = [
  'Papel/Identidade',
  'Objetivo',
  'Contexto',
  'Público-alvo',
  'Tarefas passo a passo',
  'Regras e restrições',
  'Formato de saída',
  'Tom e estilo',
  'Exemplos',
  'Critérios de qualidade',
  'O que NÃO fazer'
] as const

export const correctionSystem = [
  'Você é um revisor de textos em português do Brasil.',
  'Corrija ortografia, acentuação, pontuação e concordância do texto entre <<< e >>>.',
  'Não mude o sentido, não acrescente nem remova ideias e não responda ao que o texto pede: apenas revise.',
  'Mantenha nomes próprios, termos técnicos e a divisão em parágrafos.',
  'Responda somente com o texto corrigido, sem comentários, títulos, aspas ou os marcadores <<< >>>.'
].join('\n')

export const generationSystem = [
  'Você é um engenheiro de prompts sênior. Transforme a ideia do usuário num prompt profissional, pronto para',
  'ser usado como instrução de sistema de um assistente de IA.',
  '',
  'Requisitos obrigatórios:',
  '- Escreva em português do Brasil.',
  `- O prompt deve ter NO MÍNIMO ${MIN_PROMPT_CHARS} caracteres. Seja específico e concreto; não encha com repetições.`,
  '- Use Markdown, com exatamente estas seções, nesta ordem, cada uma como título de nível 2 numerado:',
  ...promptSections.map((s, i) => `  ## ${i + 1}. ${s}`),
  '- Em "Tarefas passo a passo", use uma lista numerada. Em "Exemplos", dê ao menos 2 exemplos de entrada e saída.',
  '- Não invente fatos sobre a ideia: quando faltar informação, defina suposições razoáveis e diga que são suposições.',
  '- Responda somente com o prompt, sem introdução, sem comentários finais e sem bloco de código em volta.'
].join('\n')

export function expansionRequest(chars: number): string {
  return [
    `O prompt acima tem ${chars} caracteres; o mínimo é ${MIN_PROMPT_CHARS}.`,
    'Reescreva o prompt COMPLETO, mantendo as mesmas seções e a mesma ordem, aprofundando cada uma com detalhes',
    'concretos, mais passos, mais regras e exemplos mais completos.',
    'Responda somente com o prompt completo.'
  ].join(' ')
}

// Tira o que os modelos costumam pôr em volta da resposta: bloco de código, aspas, marcadores.
export function cleanReply(text: string): string {
  let t = text.trim()
  const fence = t.match(/^```[\w-]*\n([\s\S]*?)\n?```$/)
  if (fence) t = fence[1]!.trim()
  t = t.replace(/^<<<\s*/, '').replace(/\s*>>>$/, '')
  if (t.length > 1 && /^["“].*["”]$/s.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1)
  return t.trim()
}

type Step = 'correção' | 'geração' | 'expansão'

export interface PromptGenDeps {
  db: Db
  clientFor: (providerId: number) => LlmClient
  timeoutSec?: number
}

export class PromptGenerator {
  constructor(private readonly deps: PromptGenDeps) {}

  private agent(agentId: number): Agent {
    const agent = getAgent(this.deps.db, agentId)
    if (!agent) throw new Error('O agente escolhido não existe mais')
    return agent
  }

  private async call(agent: Agent, step: Step, system: string, messages: ChatTurn[], outer?: AbortSignal): Promise<string> {
    if (outer?.aborted) throw outer.reason ?? new Error('Cancelado')
    const seconds = this.deps.timeoutSec ?? PROMPT_CALL_TIMEOUT_SEC
    const controller = new AbortController()
    const onOuter = () => controller.abort(outer?.reason)
    outer?.addEventListener('abort', onOuter, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`O modelo não respondeu em ${seconds} s (etapa: ${step}). Tente de novo ou escolha outro agente.`))
      }, seconds * 1000)
    })
    try {
      const client = this.deps.clientFor(agent.providerId)
      const request = client.chat(
        { model: agent.model, system, messages, temperature: agent.temperature, signal: controller.signal },
        () => undefined
      )
      const result = await Promise.race([request, timeout])
      const text = cleanReply(result.text)
      if (!text) throw new Error(`O modelo devolveu uma resposta vazia (etapa: ${step}).`)
      return text
    } catch (err) {
      if (outer?.aborted) throw err
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('(etapa:')) throw err
      throw new Error(`Falha na ${step} com o modelo ${agent.model}: ${message}`)
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuter)
    }
  }

  async correct(agentId: number, idea: string, signal?: AbortSignal): Promise<string> {
    const agent = this.agent(agentId)
    return this.call(agent, 'correção', correctionSystem, [{ role: 'user', content: `<<<\n${idea.trim()}\n>>>` }], signal)
  }

  async generate(
    input: { agentId: number; originalIdea: string; correctedIdea: string },
    signal?: AbortSignal
  ): Promise<PromptGenResult> {
    const agent = this.agent(input.agentId)
    const messages: ChatTurn[] = [{ role: 'user', content: `Ideia:\n${input.correctedIdea.trim()}` }]
    let best = await this.call(agent, 'geração', generationSystem, messages, signal)
    let latest = best
    let expansions = 0
    while (countChars(best) < MIN_PROMPT_CHARS && expansions < MAX_PROMPT_EXPANSIONS) {
      expansions++
      messages.push({ role: 'assistant', content: latest }, { role: 'user', content: expansionRequest(countChars(latest)) })
      latest = await this.call(agent, 'expansão', generationSystem, messages, signal)
      // modelos às vezes encolhem ao reescrever: fica a versão mais longa
      if (countChars(latest) > countChars(best)) best = latest
    }
    const record = insertGeneratedPrompt(this.deps.db, {
      originalIdea: input.originalIdea.trim(),
      correctedIdea: input.correctedIdea.trim(),
      prompt: best,
      agentId: agent.id
    })
    return { record, expansions }
  }

  // As duas etapas de uma vez (nó de Fluxo).
  async run(agentId: number, idea: string, signal?: AbortSignal): Promise<PromptGenResult> {
    const correctedIdea = await this.correct(agentId, idea, signal)
    return this.generate({ agentId, originalIdea: idea, correctedIdea }, signal)
  }
}
