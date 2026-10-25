import { AnthropicClient } from './anthropic'
import { OllamaClient } from './ollama'
import { OpenAiCompatClient } from './openai-compat'
import type { ClientConfig, LlmClient } from './provider'

export type ClientFactory = (config: ClientConfig) => LlmClient

export const createClient: ClientFactory = ({ kind, baseUrl, apiKey }) => {
  switch (kind) {
    case 'openai':
      return new OpenAiCompatClient(baseUrl, apiKey)
    case 'anthropic':
      return new AnthropicClient(baseUrl, apiKey)
    case 'ollama':
      return new OllamaClient(baseUrl)
  }
}
