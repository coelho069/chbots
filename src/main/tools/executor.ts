// ============================================================
//  Executor — executa ferramentas nativas via registry
//  Pattern: Function Calling / Executor
//  Resolve tool IDs do registry, executa o wrapper nativo e trata erros.
// ============================================================

import { TOOL_REGISTRY, NATIVE_WRAPPERS, type ToolDef } from './registry';

// ============================================================
//  Tipos
// ============================================================

export interface ToolCallRequest {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  content: string;       // JSON string (para LLM)
  isError: boolean;
  durationMs: number;
}

export interface ToolExecutorOptions {
  /** Verifica se o acesso à captura de tela deve ser solicitado automaticamente. */
  autoRequestCaptureAccess?: boolean;
}

// ============================================================
//  Executor de ferramentas nativas
// ============================================================

export class ToolExecutor {
  private instances = new Map<string, unknown>();

  constructor(private options: ToolExecutorOptions = {}) {}

  /** 
   * Resolve o ID da ferramenta no registry e retorna a definição.
   * @param toolId ID da ferramenta (ex: capture_screen, recognize_text)
   * @returns ToolDef ou null se não encontrada
   */
  resolve(toolId: string): ToolDef | null {
    const def = TOOL_REGISTRY.find((t) => t.id === toolId);
    if (!def) return null;
    return { ...def };
  }

  /** 
   * Executa uma chamada de ferramenta resolvida.
   * @param request Requisição de chamada de ferramenta
   * @returns ToolCallResult com o conteúdo JSON para o LLM
   */
  async execute(request: ToolCallRequest): Promise<ToolCallResult> {
    const start = Date.now();
    try {
      const def = this.resolve(request.name);
      if (!def) {
        return {
          toolCallId: request.toolCallId,
          name: request.name,
          content: JSON.stringify({ error: 'ferramenta_nao_encontrada', toolCallId: request.toolCallId, name: request.name }),
          isError: true,
          durationMs: Date.now() - start
        };
      }

      // Resolve o wrapper nativo
      const loader = NATIVE_WRAPPERS[request.name];
      if (!loader) {
        return {
          toolCallId: request.toolCallId,
          name: request.name,
          content: JSON.stringify({ error: 'wrapper_nativo_nao_disponivel', toolCallId: request.toolCallId, name: request.name }),
          isError: true,
          durationMs: Date.now() - start
        };
      }

      let instance = this.instances.get(request.name) as object | undefined;
      if (!instance) {
        const ctor = loader();
        if (typeof ctor !== 'function') {
          return {
            toolCallId: request.toolCallId,
            name: request.name,
            content: JSON.stringify({ error: 'constructor_nao_funcional', toolCallId: request.toolCallId, name: request.name }),
            isError: true,
            durationMs: Date.now() - start
          };
        }
        instance = new ctor();
        this.instances.set(request.name, instance);
      }

      // Executa a ação apropriada conforme a ferramenta
      const result = await this.invoke(instance, request.name, request.arguments);

      return {
        toolCallId: request.toolCallId,
        name: request.name,
        content: JSON.stringify(result),
        isError: false,
        durationMs: Date.now() - start
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: request.toolCallId,
        name: request.name,
        content: JSON.stringify({
          error: 'execucao_falhou',
          message,
          stack: message.includes('stack') ? '' : undefined,
          toolCallId: request.toolCallId,
          name: request.name
        }),
        isError: true,
        durationMs: Date.now() - start
      };
    }
  }

  /** 
   * Invoca o método apropriado do wrapper com base no ID da ferramenta.
   * Mapeia parâmetros do JSON schema para a API nativa.
   */
  private async invoke(instance: object, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'capture_screen': {
        const screenCapture = instance as import('../native/screen-capture').ScreenCapture;
        // Se rect é fornecido, usa captureRect; senão, usa captureWindow ou capturePrimaryDisplay
        if (args.rect && typeof args.rect === 'object') {
          const rect = args.rect as { x: number; y: number; width: number; height: number };
          return screenCapture.captureRect(rect.x, rect.y, rect.width, rect.height);
        }
        if (args.windowId && typeof args.windowId === 'string') {
          return screenCapture.captureWindow(args.windowId);
        }
        // Sem parâmetros: captura a janela ativa ou primary display
        if (this.options.autoRequestCaptureAccess) {
          await (screenCapture as any).requestAccess();
        }
        return screenCapture.capturePrimaryDisplay();
      }

      case 'recognize_text': {
        const ocr = instance as import('../native/ocr').Ocr;
        const imageBase64 = args.imageBase64 as string;
        // Se o JSON vêm com "imageBase64", o wrapper nativo espera Buffer ou string
        return ocr.recognizeText(imageBase64);
      }

      case 'scan_processes': {
        const processList = instance as import('../native/process-list').ProcessList;
        if (args.filter && typeof args.filter === 'object') {
          const filter = args.filter as { pid?: number; name?: string };
          const filters: number[] = [];
          if (filter.pid) filters.push(filter.pid as number);
          return processList.scan(filters.length > 0 ? filters : undefined);
        }
        return processList.scan();
      }

      case 'check_environment': {
        const vmDetection = instance as import('../native/vm-detection').VmDetection;
        return vmDetection.checkSecurityEnvironment();
      }

      default:
        throw new Error(`metodo_nao_implementado: ${toolName}`);
    }
  }

  /** 
   * Gera uma resposta simples de ferramenta (paraferramentas que não retornam resultados complexos).
   */
  static toResult(content: unknown, isError = false): ToolCallResult {
    return {
      toolCallId: 'unknown',
      name: 'unknown',
      content: JSON.stringify(content),
      isError,
      durationMs: 0
    };
  }
}

// ============================================================
//  Exportação padrão
// ============================================================

export default ToolExecutor;
