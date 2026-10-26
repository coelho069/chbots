// ============================================================
//  ocr — reconhecimento de texto local (wrapper TS)
//  Baseado no módulo nativo sand-card-text-recognition do Grok Bot.
//  API: reconhece Base64/Buffer imagem e retorna texto estruturado.
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

export interface TextLine {
  text: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  font?: string;
  size?: number;
}

export interface RecognizeResult {
  text: string;
  lines: TextLine[];
  confidence: number;
  meta?: Record<string, unknown>;
}

// ============================================================
//  Anexo: conversão Base64 -> Buffer
// ============================================================

/** Converte uma string Base64 ou Buffer em Buffer nativo. */
export function toBuffer(input: string | Buffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  // Remove cabeçalho data:image/png;base64, se presente
  const base64 = input.replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(base64, 'base64');
}

// ============================================================
//  API principal
// ============================================================

export class Ocr {
  /** Verifica se o OCR local está disponível. */
  public isAvailable(): boolean {
    try {
      return typeof binding.recognizeTextAsync === 'function';
    } catch {
      return false;
    }
  }

  /** 
   * Reconhece texto de uma imagem (PNG/JPEG).
   * @param image - String base64 (com ou sem header data://) ou Buffer binário.
   * @returns Promise<RecognizeResult>
   */
  public async recognizeText(image: string | Buffer): Promise<RecognizeResult> {
    if (!this.isAvailable()) {
      throw new Error('binding.recognizeTextAsync não disponível no native binding');
    }
    const buffer = toBuffer(image);
    return binding.recognizeTextAsync(buffer);
  }

  /** Reconhece texto de múltiplas imagens em paralelo. */
  public async recognizeTexts(images: (string | Buffer)[]): Promise<RecognizeResult[]> {
    if (!this.isAvailable()) {
      throw new Error('binding.recognizeTextsAsync não disponível no native binding');
    }
    const buffers = images.map((img) => toBuffer(img));
    return binding.recognizeTextsAsync(buffers);
  }
}

// ============================================================
//  Exportação padrão
// ============================================================

export default Ocr;
