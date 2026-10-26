import { z } from 'zod'
import { MAX_NEWS_COUNT, newsLanguageCodes, type NewsLanguage } from './flows'

// Validação das entradas que chegam ao processo main pelo IPC.
const providerKinds = ['openai', 'anthropic', 'ollama'] as const

export const idSchema = z.number().int().positive()

export const providerInput = z.object({
  kind: z.enum(providerKinds),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().url(),
  // undefined = manter a chave atual; '' = remover
  apiKey: z.string().optional()
})
export type ProviderInput = z.infer<typeof providerInput>


export const routineInput = z.object({
  name: z.string().trim().min(1).max(80),
  cron: z.string().trim().min(1),
  sourceAgentId: idSchema,
  taskPrompt: z.string().trim().min(1).max(50_000),
  targetAgentId: idSchema.nullable(),
  handoffPrompt: z.string().max(50_000).nullable(),
  enabled: z.boolean(),
  notifyOnlyWhenChanged: z.boolean().default(false)
})
export type RoutineInput = z.infer<typeof routineInput>

export const sendInput = z.object({
  conversationId: idSchema,
  text: z.string().trim().min(1).max(200_000),
  attachments: z.array(z.object({
    name: z.string(),
    mediaType: z.string(),
    data: z.string(),
    size: z.number().max(10 * 1024 * 1024)
  })).optional()
})

export const handoffInput = z.object({
  messageId: idSchema,
  toAgentId: idSchema,
  instruction: z.string().max(50_000)
})
export type HandoffInput = z.infer<typeof handoffInput>

// ---- Gerador de Prompts ----

export const promptIdea = z.string().trim().min(1, 'Escreva a sua ideia').max(20_000)

export const promptGenerateInput = z.object({
  agentId: idSchema,
  originalIdea: promptIdea,
  correctedIdea: promptIdea
})
export type PromptGenerateInput = z.infer<typeof promptGenerateInput>

export const promptSaveMdInput = z.object({
  content: z.string().min(1).max(500_000),
  suggestedName: z.string().max(120)
})

// ---- Fluxos ----

const nodeId = z.string().min(1).max(64)
const position = z.object({ x: z.number().finite(), y: z.number().finite() })
const timeoutSec = z.number().int().min(5).max(600)

const flowNode = z.discriminatedUnion('type', [
  z.object({
    id: nodeId,
    type: z.literal('trigger'),
    position,
    data: z.object({
      mode: z.enum(['manual', 'schedule']),
      cron: z.string().max(100),
      input: z.string().max(50_000)
    })
  }),
  z.object({
    id: nodeId,
    type: z.literal('news'),
    position,
    data: z.object({
      topic: z.string().max(200),
      language: z.enum(newsLanguageCodes as [NewsLanguage, ...NewsLanguage[]]),
      count: z.number().int().min(1).max(MAX_NEWS_COUNT),
      timeoutSec
    })
  }),
  z.object({
    id: nodeId,
    type: z.literal('promptgen'),
    position,
    data: z.object({ agentId: idSchema.nullable(), timeoutSec })
  }),
  z.object({
    id: nodeId,
    type: z.literal('agent'),
    position,
    data: z.object({ agentId: idSchema.nullable(), refinePrompt: z.string().max(50_000), timeoutSec })
  }),
  z.object({
    id: nodeId,
    type: z.literal('condition'),
    position,
    data: z.object({
      operator: z.enum(['contains', 'not_contains']),
      value: z.string().max(1_000),
      caseSensitive: z.boolean()
    })
  }),
  z.object({
    id: nodeId,
    type: z.literal('output'),
    position,
    data: z.object({
      action: z.enum(['save_md', 'notify']),
      folder: z.string().max(500),
      fileName: z.string().max(200),
      title: z.string().max(200),
      timeoutSec
    })
  }),
  z.object({
    id: nodeId,
    type: z.literal('memory'),
    position,
    data: z.object({
      mode: z.enum(['save', 'search']),
      categories: z.array(z.string().max(80)).max(20),
      limit: z.number().int().min(1).max(50),
      source: z.string().max(200),
      timeoutSec
    })
  }),
  z.object({
    id: nodeId,
    type: z.literal('delegate'),
    position,
    data: z.object({ agentId: idSchema.nullable(), timeoutSec })
  }),
  z.object({
    id: nodeId,
    type: z.literal('mcp-tool'),
    position,
    data: z.object({
      serverName: z.string().max(80),
      toolName: z.string().max(200),
      args: z.string().max(10_000),
      timeoutSec
    })
  }),
  z.object({
    id: nodeId,
    type: z.literal('claude-code'),
    position,
    data: z.object({
      tarefa: z.string().max(10_000),
      pasta: z.string().max(500),
      modelo: z.string().trim().regex(/^[\w.:/][\w.:/-]*$/, 'Modelo inválido').max(100),
      // até 2 h: o Claude Code local em CPU leva minutos por chamada
      timeoutSec: z.number().int().min(5).max(7200)
    })
  }),
])

export const flowGraphInput = z.object({
  // o limite real (10) é checado em validateGraph, com mensagem melhor
  nodes: z.array(flowNode).max(50),
  edges: z
    .array(
      z.object({
        id: nodeId,
        source: nodeId,
        target: nodeId,
        conditionValue: z.enum(['true', 'false']).nullable()
      })
    )
    .max(200)
})

export const flowMetaInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2_000)
})

export const flowSaveInput = flowMetaInput.extend({ graph: flowGraphInput })

export const delegationConfigInput = z.object({
  agentId: idSchema,
  podeDelegar: z.boolean(),
  podeReceber: z.boolean(),
  destinosPermitidos: z.array(idSchema).max(50),
  maxProfundidade: z.number().int().min(1).max(10),
  maxPorResposta: z.number().int().min(1).max(10)
})
export type DelegationConfigInput = z.infer<typeof delegationConfigInput>

export const settingsInput = z.object({
  minimizeToTray: z.boolean(),
  notifyOnRun: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650).default(30),
  apiToken: z.string().optional(),
  claudeCodeModel: z.string().trim().regex(/^[\w.:/][\w.:/-]*$/, 'Modelo inválido').max(100).optional(),
  claudeCodeTimeoutMin: z.number().int().min(1).max(120).optional()
})

// ---- MCP ----

const mcpEnvRecord = z.record(z.string().max(200)).default({})

export const mcpStdioConfigInput = z.object({
  transport: z.literal('stdio'),
  command: z.string().trim().min(1).max(500),
  args: z.array(z.string().max(500)).max(50).default([]),
  env: mcpEnvRecord
})

export const mcpHttpConfigInput = z.object({
  transport: z.literal('http'),
  url: z.string().trim().url().max(2000),
  headers: z.record(z.string().max(500)).default({})
})

export const mcpServerConfigInput = z.discriminatedUnion('transport', [mcpStdioConfigInput, mcpHttpConfigInput])

export const mcpServerAddInput = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  config: mcpServerConfigInput
})

export const mcpToolRefInput = z.object({
  serverName: z.string().min(1).max(80),
  toolName: z.string().min(1).max(200)
})

export const mcpApprovalInput = z.object({
  requestId: z.string().uuid(),
  approved: z.boolean()
})

// agentInput extended with MCP tools list
export const agentInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  systemPrompt: z.string().max(50_000),
  providerId: idSchema,
  model: z.string().trim().min(1).max(200),
  temperature: z.number().min(0).max(2),
  usarCache: z.boolean().default(false),
  mcpTools: z.array(mcpToolRefInput).max(100).default([]),
  verificarFontes: z.boolean().default(false),
  verificadorProviderId: idSchema.nullable().default(null),
  verificadorModel: z.string().trim().max(200).nullable().default(null)
})
export type AgentInput = z.infer<typeof agentInput>
