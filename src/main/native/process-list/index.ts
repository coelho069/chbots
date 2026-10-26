// ============================================================
//  process-list — listagem de processos (wrapper TS)
//  Baseado no módulo nativo cursor-proclist do Grok Bot.
//  API: classe `ProcessList` com método assíncrono scan().
// ============================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
//  Loader do native binding
// ============================================================

const binding = require('node-gyp-build')(__dirname);

// ============================================================
//  Tipos — interface de retorno (PID, Nome, Args)
// ============================================================

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  extensionId: string | null;
  cpuTimeMs: number;
  memoryMB: number;
  argv: string[];
  ownerAgentId: string | null;
  requestId: string | null;
}

/** Memória do sistema (quando disponível nativamente). */
export interface SystemMemoryInfo {
  totalBytes: number;
  availableBytes: number;
  pressureLevel?: number;
}

// ============================================================
//  API principal
// ============================================================

export class ProcessList {
  /** Escaneia processos no sistema. */
  public async scan(roots?: number[]): Promise<ProcessInfo[]> {
    const v = binding.cursor_proclist_scan_async;
    if (typeof v !== 'function') {
      throw new Error('binding.cursor_proclist_scan_async não disponível');
    }
    const result = v(roots && roots.length > 0 ? roots : undefined);
    if (!Array.isArray(result)) {
      throw new Error('resultado inesperado do native binding');
    }
    return result.map((item: unknown) => {
      if (!Array.isArray(item) || (item as unknown[]).length < 9) {
        throw new Error('tupla de processo inválida');
      }
      const arr = item as unknown[];
      return {
        pid: Number(arr[0]),
        ppid: Number(arr[1]),
        name: String(arr[2]),
        extensionId: arr[3] == null ? null : String(arr[3]),
        cpuTimeMs: Number(arr[4]),
        memoryMB: Number(arr[5]),
        argv: Array.isArray(arr[6]) ? arr[6] as string[] : [],
        ownerAgentId: arr[7] == null ? null : String(arr[7]),
        requestId: arr[8] == null ? null : String(arr[8]),
      } as ProcessInfo;
    });
  }

  /** Retorna informações de memória do sistema, ou null se não disponível. */
  public systemMemory(): SystemMemoryInfo | null {
    const v = binding.cursor_proclist_system_memory;
    if (typeof v !== 'function') return null;
    return v();
  }

  /** Ajusta toolbar compacta de janela do macOS (20pt corner). */
  public setCompactWindowToolbar(handle: Buffer, enabled: boolean): boolean {
    const v = binding.cursor_set_compact_window_toolbar;
    if (typeof v !== 'function') return false;
    return v(handle, enabled);
  }
}

// ============================================================
//  Exportação padrão
// ============================================================

export default ProcessList;
