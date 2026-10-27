import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CLAUDE_CODE_TOOL_DEF, handleClaudeCodeTool } from './agent'
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, Notification, safeStorage, shell, Tray } from 'electron'
import { CLOSE_CURRENT_ACCELERATOR, events } from '@shared/ipc'
import type { ChatChunk } from '@shared/types'
import { openDatabase, type Db } from './db/connection'
import { getSettings } from './db/repos/settings'
import { getProvider } from './db/repos/providers'
import { clearExpiredCache } from './db/repos/cache'
import { createEngineActions, defaultFlowsFolder } from './flows/actions'
import { FlowRunner } from './flows/runner'
import { SqliteCheckpointer, ensureCheckpointTables } from './flows/langgraphCheckpointer'
import { PromptGenerator } from './services/promptGen'
import { MemoryService } from './services/memory'
import { DelegationService } from './services/delegation'
import { registerIpc } from './ipc'
import { broadcast } from './webBridge'
import { setUpdateEmitter } from './updater'
import { createClient } from './llm'
import { McpService } from './services/mcp'
import { McpTranslationService } from './services/mcpTranslation'
import { loadMcpFile } from './mcpConfig'
import { FileSecretStore, type Cipher } from './secrets'
import { ChatService, type BuiltinToolSet } from './services/chat'
import { Scheduler } from './services/scheduler'
import { OfficeIpc } from './officeIpc'
import { listAgents } from './db/repos/agents'
import { insertPage, updatePage } from './db/repos/pages'
import { insertDraft, updateDraftStatus } from './db/repos/drafts'
import { startApiServer, type ApiControl } from './api'
import { VerificadorService } from './verificador'

const devServerUrl = process.env.ELECTRON_RENDERER_URL
const iconPath = join(__dirname, '../../resources/icon.png')

let mainWindow: BrowserWindow | null = null
let apiControl: ApiControl | undefined
let tray: Tray | null = null
let quitting = false

function isTrustedUrl(url: string): boolean {
  if (devServerUrl) return url.startsWith(devServerUrl)
  return url.startsWith('file://') && url.includes('/renderer/index.html')
}

function send(channel: string, payload?: unknown): void {
  broadcast(channel, payload)
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

setUpdateEmitter(send)

function createWindow(db: Db): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    title: 'CH BOTS',
    icon: iconPath,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Links externos abrem no navegador; a janela nunca navega para fora do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })

  // Com "minimizar para a bandeja", fechar só esconde: as rotinas continuam rodando.
  win.on('close', (event) => {
    if (!quitting && getSettings(db).minimizeToTray) {
      event.preventDefault()
      win.hide()
    }
  })

  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function quitApp(): void {
  quitting = true
  app.quit()
}

// Mesmo menu padrão do Electron (Editar/Exibir/Janela), mais "Arquivo" com o atalho de fechar.
// O menu fica escondido (autoHideMenuBar; Alt mostra), mas os atalhos funcionam em qualquer tela.
function createAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Arquivo',
        submenu: [
          {
            label: 'Fechar item atual',
            accelerator: CLOSE_CURRENT_ACCELERATOR,
            click: () => send(events.closeCurrent)
          },
          { type: 'separator' },
          { label: 'Sair do CH BOTS', click: quitApp }
        ]
      },
      { role: 'editMenu', label: 'Editar' },
      { role: 'viewMenu', label: 'Exibir' },
      { role: 'windowMenu', label: 'Janela' }
    ])
  )
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
  tray.setToolTip('CH BOTS')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir CH BOTS', click: showWindow },
      { type: 'separator' },
      { label: 'Sair', click: quitApp }
    ])
  )
  tray.on('click', showWindow)
}

function safeStorageCipher(): Cipher {
  return {
    encrypt: (plain) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Criptografia do sistema indisponível')
      return safeStorage.encryptString(plain)
    },
    decrypt: (data) => safeStorage.decryptString(data)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.mateus.chbots')
    const dataDir = app.getPath('userData')
    const dbPath = join(dataDir, 'ch-bots.db')
    // Migração única: se ch-bots.db não existe mas pilotos.db existe na pasta antiga
    const oldDataDir = join(app.getPath('appData'), 'Pilotos')
    const oldDbPath = join(oldDataDir, 'pilotos.db')
    if (!existsSync(dbPath) && existsSync(oldDbPath)) {
      mkdirSync(dataDir, { recursive: true })
      copyFileSync(oldDbPath, dbPath)
      copyFileSync(oldDbPath, join(dataDir, 'pilotos-migrado-backup.db'))
      const oldSecrets = join(oldDataDir, 'secrets.json')
      if (existsSync(oldSecrets)) copyFileSync(oldSecrets, join(dataDir, 'secrets.json'))
    }
    const db = openDatabase(dbPath)
    const secrets = new FileSecretStore(join(dataDir, 'secrets.json'), safeStorageCipher())

    const officeIpc = new OfficeIpc()
    officeIpc.registerHandlers()

    const memoryService = new MemoryService({
      db,
      clientFor: (providerId) => {
        const provider = getProvider(db, providerId)
        const apiKey = provider?.keyRef ? secrets.get(provider.keyRef) : null
        return createClient({ kind: provider?.kind ?? 'openai', baseUrl: provider?.baseUrl ?? '', apiKey })
      }
    })

    const chat = new ChatService({
      db,
      secrets,
      createClient,
      onChunk: (chunk: ChatChunk) => send(events.chatChunk, chunk),
      memory: memoryService,
      onOfficeEvent: (ev) => officeIpc.emit(ev)
      // delegation injected below after construction (circular dep)
    })

    const delegation = new DelegationService({
      db,
      chat,
      onCard: (card) => send(events.delegationCard, card)
    })
    chat.deps.delegation = delegation

    const verificador = new VerificadorService({
      db,
      secrets,
      createClient,
      onUpdated: (messageId) => send(events.verificacoesUpdated, messageId)
    })
    chat.deps.verificador = verificador

    // Resolvers para o loop de aprovação de rascunhos
    const draftResolvers = new Map<number, (approve: boolean) => void>()

    const builtinTools: BuiltinToolSet = {
      defs: [
        {
          name: 'render_page',
          description: 'Cria ou atualiza um painel HTML interativo visivel ao usuario ao lado do chat. Use para relatorios, dashboards e visualizacoes.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Titulo da page' },
              html: { type: 'string', description: 'Conteudo HTML completo' }
            },
            required: ['title', 'html']
          }
        },
        {
          name: 'update_page',
          description: 'Atualiza o HTML de uma page existente pelo id.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              html: { type: 'string' }
            },
            required: ['id', 'html']
          }
        },
        {
          name: 'send_email',
          description: 'Cria um rascunho de e-mail que o usuário deve aprovar antes de enviar. NUNCA envia automaticamente.',
          inputSchema: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Endereço de e-mail do destinatário' },
              subject: { type: 'string', description: 'Assunto do e-mail' },
              body: { type: 'string', description: 'Corpo do e-mail' }
            },
            required: ['to', 'body']
          }
        },
        {
          name: 'send_slack',
          description: 'Cria um rascunho de mensagem Slack que o usuário deve aprovar antes de enviar. NUNCA envia automaticamente.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Canal ou usuário do Slack (ex: #geral ou @usuario)' },
              text: { type: 'string', description: 'Texto da mensagem' }
            },
            required: ['channel', 'text']
          }
        },
        CLAUDE_CODE_TOOL_DEF
      ],
      // shortcut: envio real não implementado; adicionar SMTP/Slack webhook quando credenciais estiverem configuradas
      async handle(name, input, conversationId) {
        if (name === 'render_page') {
          const page = insertPage(db, String(input.title ?? 'Sem titulo'), String(input.html ?? ''))
          send(events.pageOpen, page)
          return `Page criada com id ${page.id}`
        }
        if (name === 'update_page') {
          const page = updatePage(db, Number(input.id), String(input.html ?? ''))
          send(events.pageOpen, page)
          return `Page ${page.id} atualizada`
        }
        if (name === 'send_email' || name === 'send_slack') {
          const draft = name === 'send_email'
            ? insertDraft(db, { tool: 'send_email', conversationId, recipient: String(input.to ?? ''), subject: input.subject != null ? String(input.subject) : null, body: String(input.body ?? '') })
            : insertDraft(db, { tool: 'send_slack', conversationId, recipient: String(input.channel ?? ''), subject: null, body: String(input.text ?? '') })
          send(events.draftPending, draft)
          return new Promise<string>((resolve) => {
            draftResolvers.set(draft.id, (approve) => {
              draftResolvers.delete(draft.id)
              if (approve) {
                updateDraftStatus(db, draft.id, 'sent')
                resolve('Mensagem enviada com sucesso.')
              } else {
                updateDraftStatus(db, draft.id, 'discarded')
                resolve('Envio cancelado pelo usuário.')
              }
            })
          })
        }
        if (name === 'claude_code') {
          const { claudeCodeModel, claudeCodeTimeoutMin } = getSettings(db)
          return handleClaudeCodeTool(input, { modelo: claudeCodeModel, timeoutMin: claudeCodeTimeoutMin }, async (tarefa, pasta) => {
            const options = {
              type: 'warning' as const,
              buttons: ['Executar', 'Cancelar'],
              defaultId: 1,
              cancelId: 1,
              title: 'Claude Code local',
              message: 'O agente quer rodar o Claude Code local (pode ler e editar arquivos).',
              detail: `Pasta: ${pasta}\n\nTarefa: ${tarefa.slice(0, 1000)}`
            }
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
            const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
            return response === 0
          })
        }
        return 'Ferramenta desconhecida'
      }
    }
    chat.deps.builtinTools = builtinTools

    const scheduler = new Scheduler({
      db,
      chat,
      onRunsChanged: () => send(events.runsChanged),
      onRunFinished: (routine, run, outputChanged) => {
        if (!getSettings(db).notifyOnRun || !Notification.isSupported()) return
        if (routine.notifyOnlyWhenChanged && !outputChanged) return
        new Notification({
          title: run.status === 'ok' ? `Rotina concluída: ${routine.name}` : `Rotina falhou: ${routine.name}`,
          body: run.status === 'ok' ? 'Abra o CH BOTS para ver a resposta.' : (run.error ?? 'Erro desconhecido'),
          icon: iconPath
        }).show()
      }
    })

    const promptGen = new PromptGenerator({ db, clientFor: (providerId) => chat.clientFor(providerId) })

    const mcpTranslation = new McpTranslationService(db, chat)
    const mcpService = new McpService({
      onStatusChanged: () => send(events.mcpStatusChanged),
      onApprovalRequest: (req) => {
        send(events.mcpApprovalRequest, req)
        if (process.platform === 'win32' && (!mainWindow || mainWindow.isMinimized() || !mainWindow.isVisible()) && Notification.isSupported()) {
          new Notification({
            title: 'Aprovação MCP necessária',
            body: `${req.serverName}.${req.toolName} aguarda sua decisão.`,
            icon: iconPath
          }).show()
        }
      },
      onToolCall: (event) => send(events.mcpToolCall, event),
      onOfficeEvent: (ev) => officeIpc.emit(ev),
      translateTools: (serverName, tools) => mcpTranslation.translate(serverName, tools)
    })
    chat.deps.mcpService = mcpService

    ensureCheckpointTables(db)
    const checkpointer = new SqliteCheckpointer(db)

    const flowRunner = new FlowRunner({
      db,
      checkpointer,
      actionsFor: createEngineActions({
        db,
        chat,
        delegation,
        promptGen,
        mcpService,
        defaultFolder: defaultFlowsFolder(app.getPath('documents')),
        notify: (title, body) => {
          if (Notification.isSupported()) new Notification({ title, body, icon: iconPath }).show()
        }
      }),
      onStep: (event) => send(events.flowStep, event),
      onRunsChanged: (flowId) => send(events.flowRunsChanged, flowId),
      onInterrupt: (event) => send(events.flowInterrupt, { runId: event.runId, flowId: event.flowId, nodeId: event.value.nodeId, nodeType: event.value.nodeType, description: event.value.description }),
      onRunFinished: (flowName, run) => {
        if (!getSettings(db).notifyOnRun || !Notification.isSupported()) return
        new Notification({
          title: run.status === 'ok' ? `Fluxo concluído: ${flowName}` : `Fluxo falhou: ${flowName}`,
          body: run.status === 'ok' ? 'Abra o CH BOTS para ver o resultado.' : (run.error ?? 'Erro desconhecido'),
          icon: iconPath
        }).show()
      }
    })

    registerIpc({
      db,
      secrets,
      chat,
      delegation,
      scheduler,
      flowRunner,
      promptGen,
      mcpService,
      dataDir,
      onSettingsChanged: (s) => apiControl?.setEnabled(s.apiEnabled),
      getWindow: () => mainWindow,
      isTrustedUrl,
      getApi: () => apiControl,
      resolveDraft: (draftId, approve) => draftResolvers.get(draftId)?.(approve),
      verificador
    })

    apiControl = startApiServer({ db, secrets, createClient })
    createAppMenu()
    mainWindow = createWindow(db)
    officeIpc.setWindow(mainWindow)
    // Register desks for all existing agents
    for (const a of listAgents(db)) officeIpc.registerDesk(a.id, a.name, a.color)
    createTray()

    // Defer non-essential startup work 3s after window is visible
    mainWindow.once('ready-to-show', () => {
      setTimeout(() => {
        const { retentionDays } = getSettings(db)
        db.prepare('DELETE FROM flow_runs WHERE status != ? AND started_at < datetime(?, ?)')
          .run('running', 'now', `-${retentionDays} days`)
        db.prepare('DELETE FROM routine_runs WHERE status != ? AND started_at < datetime(?, ?)')
          .run('running', 'now', `-${retentionDays} days`)
        clearExpiredCache(db)
        setInterval(() => clearExpiredCache(db), 6 * 60 * 60 * 1000)
        setInterval(() => db.prepare('VACUUM').run(), 7 * 24 * 60 * 60 * 1000)
        scheduler.start()
        flowRunner.startScheduling()
      }, 3000)
    })

    // Connect MCP servers in the background as soon as the window is ready.
    // McpService reuses existing clients and capability snapshots on later loads.
    mainWindow.once('ready-to-show', () => {
      const startedAt = Date.now()
      void mcpService.loadAll(loadMcpFile(dataDir)).then(() => console.info(`[MCP] startup status=ready durationMs=${Date.now() - startedAt}`)).catch((error: unknown) => {
        console.warn(`[MCP] startup status=error durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`)
      }).catch((error: unknown) => {
        console.warn('[MCP] falha ao carregar servidores na inicialização:', error)
      })
    })

    app.on('before-quit', () => {
      quitting = true
      scheduler.stop()
      flowRunner.stop()
      void mcpService.stopAll()
    })
    app.on('will-quit', () => db.close())
  })

  // Só chega aqui quando a janela fechou de verdade (bandeja desligada ou "Sair").
  app.on('window-all-closed', () => app.quit())
}
