import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { buildApi } from '@shared/apiFactory'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// API mínima e tipada; o renderer não tem acesso ao ipcRenderer em si.
const api = buildApi(invoke, subscribe)

contextBridge.exposeInMainWorld('pilotos', api)
