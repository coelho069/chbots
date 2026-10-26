// ============================================================
//  screen-capture — captura de tela e janelas (wrapper TS)
//  Baseado no módulo nativo sand-window-capture do Grok Bot.
//  API: classe `ScreenCapture` com métodos assíncronos.
// ============================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
//  Loader do native binding
// ============================================================

const binding = require('node-gyp-build')(__dirname);

// ============================================================
//  Tipos
// ============================================================

export interface CaptureResult {
  totalBytes: number;
  availableBytes?: number;
  pressureLevel?: number;
  dataUrl: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}

export interface WindowInfo {
  id: string;
  pid: number;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  owner: string | null;
}

export type CaptureAccessStatus = 'granted' | 'denied' | 'unsupported';

// ============================================================
//  Classe Wrapper
// ============================================================

export class ScreenCapture {
  private accessStatus: CaptureAccessStatus = 'unsupported';

  public get access(): CaptureAccessStatus {
    return this.accessStatus;
  }

  /** Verifica o status atual de acesso à captura. */
  public async checkAccess(): Promise<CaptureAccessStatus> {
    const v = binding.screenCaptureAccessSync;
    if (typeof v !== 'function') throw new Error('binding.screenCaptureAccessSync não disponível');
    this.accessStatus = v();
    return this.accessStatus;
  }

  /** Solicita acesso à captura de tela. Retorna true se concedido. */
  public async requestAccess(): Promise<boolean> {
    const v = binding.requestScreenCaptureAccessSync;
    if (typeof v !== 'function') throw new Error('binding.requestScreenCaptureAccessSync não disponível');
    const granted = v();
    this.accessStatus = granted ? 'granted' : 'denied';
    return granted;
  }

  /** Lista todas as janelas visíveis no sistema. */
  public async listWindows(): Promise<WindowInfo[]> {
    const v = binding.listWindowsSync;
    if (typeof v !== 'function') throw new Error('binding.listWindowsSync não disponível');
    const raw = v();
    if (!Array.isArray(raw)) throw new Error('resultado inesperado do native binding');
    return raw.map((w: unknown) => {
      if (!w || typeof w !== 'object') throw new Error('janela inválida');
      const obj = w as Record<string, unknown>;
      return {
        id: String(obj.id),
        pid: Number(obj.pid),
        layer: Number(obj.layer),
        x: Number(obj.x),
        y: Number(obj.y),
        width: Number(obj.width),
        height: Number(obj.height),
        owner: obj.owner == null ? null : String(obj.owner),
      } as WindowInfo;
    });
  }

  /** Captura uma janela completa. */
  public async captureWindow(windowId: string | number): Promise<CaptureResult> {
    const v = binding.captureWindowAsync;
    if (typeof v !== 'function') throw new Error('binding.captureWindowAsync não disponível');
    return v(typeof windowId === 'string' ? windowId : String(windowId));
  }

  /** Captura uma região retangular da tela. */
  public async captureRect(x: number, y: number, width: number, height: number, excludeWindowIds?: string[]): Promise<CaptureResult> {
    const v = binding.captureRectAsync;
    if (typeof v !== 'function') throw new Error('binding.captureRectAsync não disponível');
    const args = [x, y, width, height];
    if (excludeWindowIds && excludeWindowIds.length > 0) args.push(excludeWindowIds);
    return v(...args);
  }

  /** Captura a janela ativa ou a primeira janela disponível. */
  public async captureActiveWindow(): Promise<CaptureResult> {
    const windows = await this.listWindows();
    if (windows.length === 0) throw new Error('Nenhuma janela disponível');
    return this.captureWindow(windows[0].id);
  }

  /** Captura o monitor principal (se acesso estiver concedido). */
  public async capturePrimaryDisplay(): Promise<CaptureResult> {
    if (this.accessStatus !== 'granted') {
      const granted = await this.requestAccess();
      if (!granted) throw new Error('Acesso à captura de tela negado');
    }
    const windows = await this.listWindows();
    if (windows.length === 0) throw new Error('Nenhuma janela disponível');
    const bounds = windows[0];
    return this.captureRect(bounds.x, bounds.y, bounds.width, bounds.height, [String(bounds.id)]);
  }
}

export default ScreenCapture;
