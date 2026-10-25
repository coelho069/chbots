import type { PilotosApi } from '../shared/types'

declare global {
  interface Window {
    pilotos: PilotosApi
  }
}

export {}
