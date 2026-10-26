// ============================================================
//  vm-detection — detecção de VM / ambiente isolado (wrapper TS)
//  Baseado no módulo nativo sand-devicheck do Grok Bot.
//  API: boolean security check para validação de ambiente.
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

export interface SecurityEnvironment {
  isIsolated: boolean;
  deviceCheckSupported: boolean;
  deviceCheckToken?: string;
  hvVmmPresent: boolean;
  details?: Record<string, unknown>;
}

// ============================================================
//  API principal
// ============================================================

export class VmDetection {
  /** Verifica se o DeviceCheck está suportado no sistema. */
  public isSupported(): boolean {
    const v = binding.isSupported;
    if (typeof v !== 'function') throw new Error('binding.isSupported não disponível');
    return v();
  }

  /** Gera um token DeviceCheck (usado para validação de dispositivo). */
  public generateToken(): string {
    const v = binding.generateToken;
    if (typeof v !== 'function') throw new Error('binding.generateToken não disponível');
    return v();
  }

  /** 
   * Verifica se um hipervisor/VMM está presente no sistema.
   * @returns boolean - true se VM/hipervisor detectado
   */
  public hvVmmPresent(): boolean {
    const v = binding.hvVmmPresent;
    if (typeof v !== 'function') throw new Error('binding.hvVmmPresent não disponível');
    return v();
  }

  /** 
   * Verifica se o ambiente é isolado (VM, contêiner ou similar).
   * @returns SecurityEnvironment
   */
  public checkSecurityEnvironment(): SecurityEnvironment {
    const hvVmm = this.hvVmmPresent();
    const supported = this.isSupported();
    let token: string | undefined;
    if (supported) {
      try {
        token = this.generateToken();
      } catch {
        // token não disponível, ignorar
      }
    }
    return {
      isIsolated: hvVmm,
      deviceCheckSupported: supported,
      deviceCheckToken: token,
      hvVmmPresent: hvVmm,
    } as SecurityEnvironment;
  }

  /** 
   * Check de segurança booleano: true se o ambiente parece ser uma VM/hypervisor.
   * Uso típico: verificação prévia de segurança.
   */
  public isVirtualized(): boolean {
    return this.hvVmmPresent();
  }

  /** 
   * Check de segurança booleano: true se DeviceCheck está disponível.
   */
  public isDeviceCheckSupported(): boolean {
    return this.isSupported();
  }
}

// ============================================================
//  Exportação padrão
// ============================================================

export default VmDetection;
