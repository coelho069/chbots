import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { Db } from '../db/connection'
import { getAgent, listAgents } from '../db/repos/agents'
import { insertConversation } from '../db/repos/conversations'
import { saveFact, searchFacts } from '../db/repos/memoria'
import type { ChatService } from '../services/chat'
import type { DelegationService } from '../services/delegation'
import type { PromptGenerator } from '../services/promptGen'
import type { McpService } from '../services/mcp'
import { logMcpCall } from '../db/repos/mcp'
import { runClaudeCode } from '../claudeCode'
import type { EngineActions } from './engine'
import { buildNewsUrl, fetchNews } from './news'
import { getCachedNews, setCachedNews } from './newsCache'

// Formata número com zero à esquerda (01, 02, ... 12)
const pad = (n: number) => String(n).padStart(2, '0')

// Monta nome de arquivo substituindo {fluxo} e {data} no template, sanitizando para Windows
export function renderFileName(template: string, flowName: string, date = new Date()): string {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`
  const raw = (template.trim() || '{fluxo}-{data}.md').replaceAll('{fluxo}', flowName).replaceAll('{data}', stamp)
  let name = basename(raw.replaceAll('\\', '/'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 150)
  if (!name) name = `fluxo-${stamp}`
  return extname(name).toLowerCase() === '.md' ? name : `${name}.md`
}

// Valida que o caminho resultante fica dentro de `folder`, impedindo path traversal
export function resolveInside(folder: string, fileName: string): string {
  const root = resolve(folder)
  const target = resolve(root, fileName)
  if (dirname(target) !== root || basename(target) !== fileName) throw new Error('Nome de arquivo inválido')
  return target
}

// Factory que retorna função para salvar markdown com timestampo no nome, evitando sobrescrita
export function createSaveMarkdown(defaultFolder: string, now: () => Date = () => new Date()) {
  return async ({ folder, fileName, content, flowName }: { folder: string; fileName: string; content: string; flowName: string }) => {
    const dir = folder.trim() || defaultFolder
    await mkdir(dir, { recursive: true })
    const name = renderFileName(fileName, flowName, now())
    const stem = name.slice(0, -3)
    // não sobrescreve: acrescenta -2, -3... se o nome já existir
    for (let i = 1; i < 1000; i++) {
      const target = resolveInside(dir, i === 1 ? name : `${stem}-${i}.md`)
      try {
        await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
        return target
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
    throw new Error('Não foi possível escolher um nome de arquivo livre')
  }
}

// Factory que retorna ações do engine de fluxos: executar agentes, salvar markdown, buscar notícias, etc.
export function createEngineActions(deps: {
  db: Db
  chat: ChatService
  delegation?: DelegationService
  promptGen: PromptGenerator
  mcpService?: McpService
  defaultFolder: string
  notify: (title: string, body: string) => void
}): (flowName: string) => EngineActions {
  const save = createSaveMarkdown(deps.defaultFolder)
  return (flowName) => ({
    async runAgent({ agentId, prompt, signal }) {
      // Executa um nó de agente no fluxo: cria conversa, envia prompt, retorna resposta
      if (!getAgent(deps.db, agentId)) throw new Error('O agente deste nó foi excluído')
      const stamp = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      const conversation = insertConversation(deps.db, agentId, 'routine', `Fluxo: ${flowName} · ${stamp}`)
      const reply = await deps.chat.send(conversation.id, prompt, { signal })
      return reply.content
    },
    saveMarkdown: ({ folder, fileName, content }) => save({ folder, fileName, content, flowName }),
    notify: ({ title, body }) => deps.notify(title, body.length > 240 ? `${body.slice(0, 237)}...` : body),
    fetchNews: async (args) => {
      // Busca notícias com cache por URL; evita requisições duplicadas
      const url = buildNewsUrl(args.topic, args.language)
      const cached = getCachedNews(url)
      if (cached) return cached
      const result = await fetchNews(args)
      setCachedNews(url, result)
      return result
    },
    generatePrompt: async ({ agentId, idea, signal }) => (await deps.promptGen.run(agentId, idea, signal)).record.prompt,
    memorySave: async ({ text, source, categories }) => {
      // Salva até 20 fatos (linhas) em memória; retorna contagem de sucessos
      const lines = text.split('\n').filter((l) => l.trim())
      let saved = 0
      for (const line of lines.slice(0, 20)) {
        const r = saveFact(deps.db, { fato: line.trim(), categoria: categories[0] ?? 'Outros', fonte: source || 'fluxo', tipo: 'conversa' })
        if (r.fatoId !== -1) saved++
      }
      return `${saved} fato(s) salvos na memória`
    },
    memorySearch: async ({ query, categories, limit }) => {
      // Busca fatos em memória com filtro opcional por categoria; formata resultado com metadados
      const fatos = searchFacts(deps.db, query, limit)
      const filtered = categories.length > 0 ? fatos.filter((f) => categories.includes(f.categoria)) : fatos
      if (filtered.length === 0) return 'Nenhum fato relevante na memória'
      return filtered.map((f) => `[${f.categoria}] ${f.fato} (fonte: ${f.fontes[0]?.fonte ?? '?'}, confiança: ${f.confianca})`).join('\n')
    },
    async delegateTask({ agentId, task }) {
      // Delega tarefa para outro agente; o primeiro agente do fluxo é a origem
      if (!deps.delegation) throw new Error('Serviço de delegação não disponível')
      const agents = listAgents(deps.db)
      const origem = agents[0]
      if (!origem) throw new Error('Nenhum agente cadastrado para delegar')
      const conv = insertConversation(deps.db, origem.id, 'routine', `Fluxo delegação → ${getAgent(deps.db, agentId)?.name ?? agentId}`)
      return deps.delegation.delegate({
        conversaId: conv.id,
        botOrigemId: origem.id,
        botDestinoId: agentId,
        tarefa: task,
        depth: 0,
        callStack: [origem.id]
      })
    },
    async mcpCallTool({ serverName, toolName, args }) {
      // Executa ferramenta MCP e registra chamada no banco; lança erro se falhar
      if (!deps.mcpService) throw new Error('Serviço MCP não disponível')
      const result = await deps.mcpService.callTool(serverName, toolName, args)
      logMcpCall(deps.db, serverName, toolName, result.isError ? 'error' : 'ok', result.durationMs)
      if (result.isError) throw new Error(result.content)
      return result.content
    },
    async claudeCode({ tarefa, pasta, modelo, signal }) {
      // Roda o Claude Code CLI local (Ollama); erro vira falha do nó
      const r = await runClaudeCode({ tarefa, pasta, modelo }, signal)
      if (!r.ok) throw new Error(`Claude Code: ${r.erro}`)
      return r.resposta
    }
  })
}

// Pasta padrão para salvar fluxos: Documents/CH BOTS
export const defaultFlowsFolder = (documents: string) => join(documents, 'CH BOTS')
