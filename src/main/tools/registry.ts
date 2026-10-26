// ============================================================
//  Registry — mapeamento de ferramentas nativas para JSON Schemas
//  Pattern: Function Calling / Tool Registry
//  Mapeia wrappers nativos (src/main/native/) para definições que o LLM pode consumir.
// ============================================================

import { z } from 'zod';

// ============================================================
//  Definições base das ferramentas nativas
// ============================================================

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; default?: unknown }>;
    required: string[];
  };
}

// ============================================================
//  Tipagem dos parâmetros
// ============================================================

export const windowIdParam = z.object({
  windowId: z.string().describe('ID da janela a capturar (retornado por list_windows)')
});

export const rectParam = z.object({
  rect: z.object({
    x: z.number().describe('Coordenada X do canto superior esquerdo do retângulo'),
    y: z.number().describe('Coordenada Y do canto superior esquerdo do retângulo'),
    width: z.number().describe('Largura do retângulo em pixels'),
    height: z.number().describe('Altura do retângulo em pixels')
  }).describe('Região da tela a ser capturada')
});

export const imageBase64Param = z.object({
  imageBase64: z.string().describe('Imagem em Base64 (PNG/JPEG). Pode incluir header data://').transform((v) => v)
});

export const filterParam = z.object({
  filter: z.object({
    pid: z.number().optional().describe('Filtrar por PID exato'),
    name: z.string().optional().describe('Filtrar por parte do nome do processo (match case-insensitive)')
  }).optional().describe('Filtro opcional de processos')
});

export const checkEnvironmentParams = z.object({});

// ============================================================
//  Registry de ferramentas nativas
// ============================================================

export const TOOL_REGISTRY: ToolDef[] = [
  {
    id: 'capture_screen',
    name: 'capture_screen',
    description: 'Captura uma janela ou região da tela. Retorna imagem em Base64 (PNG).',
    parameters: {
      type: 'object',
      properties: {
        windowId: { type: 'string', description: 'ID da janela a capturar (retornado por list_windows). Se omitido, captura a primeira janela disponível.' },
        rect: {
          type: 'object',
          description: 'Região da tela a ser capturada. Se fornecido, ignora windowId.',
          properties: {
            x: { type: 'number', description: 'Coordenada X' },
            y: { type: 'number', description: 'Coordenada Y' },
            width: { type: 'number', description: 'Largura' },
            height: { type: 'number', description: 'Altura' }
          },
          required: ['x', 'y', 'width', 'height']
        }
      },
      required: []
    }
  },
  {
    id: 'recognize_text',
    name: 'recognize_text',
    description: 'Realiza OCR local em uma imagem (Base64) e retorna o texto reconhecido.',
    parameters: {
      type: 'object',
      properties: {
        imageBase64: { type: 'string', description: 'Imagem em Base64 (PNG/JPEG). Pode incluir header data://.' }
      },
      required: ['imageBase64']
    }
  },
  {
    id: 'scan_processes',
    name: 'scan_processes',
    description: 'Lista processos em execução no sistema. Retorna PID, nome, args e consumo de CPU/memória.',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          description: 'Filtro opcional de processos (opcional: filtro de procura)',
          properties: {
            pid: { type: 'number', description: 'Filtrar por PID exato' },
            name: { type: 'string', description: 'Filtrar por parte do nome do processo (match case-insensitive)' }
          },
          required: []
        }
      },
      required: []
    }
  },
  {
    id: 'check_environment',
    name: 'check_environment',
    description: 'Verifica o ambiente de segurança: se há VM/hipervisor presente e se DeviceCheck está disponível.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

// ============================================================
//  Mapeamento nativo -> wrapper
// ============================================================

export const NATIVE_WRAPPERS = {
  'capture_screen': () => require('../native/screen-capture').ScreenCapture,
  'recognize_text': () => require('../native/ocr').Ocr,
  'scan_processes': () => require('../native/process-list').ProcessList,
  'check_environment': () => require('../native/vm-detection').VmDetection
};

// ============================================================
//  Helper: exporta o registry como padrão
// ============================================================

export default TOOL_REGISTRY;
