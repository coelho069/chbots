// Tipos públicos do suporte MCP cliente; sem dependências de runtime.

export type McpTransport = 'stdio' | 'http'
export type McpServerStatus = 'connecting' | 'connected' | 'error' | 'off'
export type McpToolApproval = 'ask' | 'allow' | 'block'

export interface McpStdioConfig {
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>  // valores com prefixo __secret__ são criptografados em disco
}

export interface McpHttpConfig {
  transport: 'http'
  url: string
  headers?: Record<string, string>
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Localized presentation metadata; never sent to an LLM tool schema. */
  descriptionPtBr?: string
  inputSchemaPtBr?: Record<string, unknown>
  translationStatus?: 'translating' | 'translated' | 'original'
  translationError?: string
}

export interface McpServerInfo {
  name: string
  config: McpServerConfig
  enabled: boolean
  status: McpServerStatus
  error?: string
  tools: McpToolDef[]
  resources: { uri: string; name: string; description?: string }[]
  prompts: { name: string; description?: string }[]
}

export interface McpCallResult {
  content: string
  isError: boolean
  durationMs: number
}

// Por ferramenta, por agente. Key = "serverName::toolName".
export type McpApprovalMap = Record<string, McpToolApproval>

// Evento emitido do main → renderer quando o modelo pede aprovação.
export interface McpApprovalRequest {
  requestId: string
  conversationId: number
  serverName: string
  toolName: string
  args: Record<string, unknown>
}

export interface McpToolRef { serverName: string; toolName: string }
