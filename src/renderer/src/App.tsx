import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, PageRecord, Provider } from '@shared/types'
import { api } from './api'
import { CloseContext, type CloseApi } from './CloseContext'
import { createCloser, type CloseHandler } from './closeCurrent'
import { AgentsPage } from './pages/AgentsPage'
import { ChatPage } from './pages/ChatPage'
import { ToastProvider, useToast } from './toast'
import type { AgentDraft } from './pages/PromptGenPage'
import { UpdateNotification } from './components/UpdateNotification'

// Heavy pages loaded lazily to reduce initial bundle parse time
const FlowsPage    = lazy(() => import('./flows/FlowsPage').then((m) => ({ default: m.FlowsPage })))
const BlackBoxPage = lazy(() => import('./pages/BlackBoxPage').then((m) => ({ default: m.BlackBoxPage })))
const MemoryPage   = lazy(() => import('./pages/MemoryPage').then((m) => ({ default: m.MemoryPage })))
const PromptGenPage = lazy(() => import('./pages/PromptGenPage').then((m) => ({ default: m.PromptGenPage })))
const RoutinesPage  = lazy(() => import('./pages/RoutinesPage').then((m) => ({ default: m.RoutinesPage })))
const RunsPage      = lazy(() => import('./pages/RunsPage').then((m) => ({ default: m.RunsPage })))
const SettingsPage  = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const McpPage       = lazy(() => import('./pages/McpPage').then((m) => ({ default: m.McpPage })))
const OfficePage    = lazy(() => import('./pages/OfficePage').then((m) => ({ default: m.OfficePage })))
const PagesPage     = lazy(() => import('./pages/PagesPage').then((m) => ({ default: m.PagesPage })))

export type Page = 'agents' | 'chat' | 'promptgen' | 'flows' | 'routines' | 'runs' | 'blackbox' | 'settings' | 'memory' | 'mcp' | 'office' | 'pages'

const homePage: Page = 'chat'

export interface ChatTarget {
  agentId: number
  conversationId: number | null
}

const nav: { page: Page; label: string; icon: string; shortLabel: string }[] = [
  { page: 'chat',      label: 'Chat',               icon: '✉', shortLabel: 'Chat'    },
  { page: 'promptgen', label: 'Gerador de Prompts',  icon: '✍', shortLabel: 'Gerador' },
  { page: 'agents',    label: 'Agentes',             icon: '☺', shortLabel: 'Agentes' },
  { page: 'flows',     label: 'Fluxos',              icon: '⬡', shortLabel: 'Fluxos'  },
  { page: 'routines',  label: 'Rotinas',             icon: '↺', shortLabel: 'Rotinas' },
  { page: 'runs',      label: 'Execuções',           icon: '▶', shortLabel: 'Execuções'},
  { page: 'blackbox',  label: 'Caixa-Preta',         icon: '◼', shortLabel: 'C. Preta'},
  { page: 'office',   label: 'Escritório',           icon: '🏢', shortLabel: 'Escritório'},
  { page: 'memory',   label: 'Memória',              icon: '🧠', shortLabel: 'Memória' },
  { page: 'mcp',       label: 'MCP',                  icon: '⬡', shortLabel: 'MCP'     },
  { page: 'pages',     label: 'Pages',               icon: '🗒', shortLabel: 'Pages'   },
  { page: 'settings',  label: 'Configurações',       icon: '⚙', shortLabel: 'Config.' },
]

interface TabBarProps {
  tabs: Page[]
  active: Page
  dirty: Set<Page>
  onActivate: (p: Page) => void
  onClose: (p: Page) => Promise<void>
}

const TabBar = memo(function TabBar({ tabs, active, dirty, onActivate, onClose }: TabBarProps) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t) => {
        const meta = nav.find((n) => n.page === t)!
        const isDirty = dirty.has(t)
        return (
          <div
            key={t}
            role="tab"
            aria-selected={t === active}
            className={`tab-item${t === active ? ' active' : ''}`}
            onClick={() => onActivate(t)}
            title={meta.label}
          >
            <span className="tab-icon">{meta.icon}</span>
            <span className="tab-label">{meta.shortLabel}</span>
            <button
              className={`tab-close${isDirty ? ' dirty' : ''}`}
              onClick={(e) => { e.stopPropagation(); void onClose(t) }}
              title={isDirty ? 'Alterações não salvas' : 'Fechar aba'}
              aria-label="Fechar aba"
            >
              {isDirty ? '●' : '×'}
            </button>
          </div>
        )
      })}
    </div>
  )
})

export function App() {
  return (
    <ToastProvider>
      <UpdateNotification />
      <Shell />
    </ToastProvider>
  )
}

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === '1' } catch { return false }
  })
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }, [])
  return [collapsed, toggle] as const
}

function Shell() {
  const toast = useToast()
  const [page, setPage] = useState<Page>('chat')
  const [openTabs, setOpenTabs] = useState<Page[]>(['chat'])
  const [dirtyPages, setDirtyPages] = useState(new Set<Page>())
  const [agents, setAgents] = useState<Agent[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null)
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const [activeCount, setActiveCount] = useState(0)
  const [openPage, setOpenPage] = useState<PageRecord | null>(null)

  // Auto-collapse on narrow windows — setCollapsed exposed via a ref trick isn't available,
  // so we track with the existing hook by watching a media query
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)')
    if (mq.matches && !sidebarCollapsed) toggleSidebar()
    const handler = (e: MediaQueryListEvent) => { if (e.matches && !sidebarCollapsed) toggleSidebar() }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAgents = useCallback(async () => setAgents(await api.agents.list()), [])
  const reloadProviders = useCallback(async () => setProviders(await api.providers.list()), [])

  useEffect(() => {
    Promise.all([reloadAgents(), reloadProviders()])
      .catch(toast.error)
      .finally(() => setLoaded(true))
  }, [reloadAgents, reloadProviders, toast.error])

  useEffect(() => {
    if (loaded && providers.length === 0) navigate('settings')
    else if (loaded && agents.length === 0) navigate('agents')
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshActiveCount = useCallback(() => {
    api.blackbox.activeCount().then(setActiveCount).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshActiveCount()
    const unsub1 = api.flows.onRunsChanged(refreshActiveCount)
    const unsub2 = api.routines.onRunsChanged(refreshActiveCount)
    return () => { unsub1(); unsub2() }
  }, [refreshActiveCount])

  function navigate(p: Page) {
    setOpenTabs((tabs) => (tabs.includes(p) ? tabs : [...tabs, p]))
    setPage(p)
  }

  async function closeTab(p: Page) {
    if (dirtyPages.has(p)) {
      const label = nav.find((n) => n.page === p)?.label ?? p
      const choice = await api.app.askUnsaved(`A aba "${label}" tem alterações não salvas.`, false)
      if (choice === 'cancel') return
    }
    const nextTabs = openTabs.filter((t) => t !== p)
    if (nextTabs.length === 0) {
      setOpenTabs([homePage])
      setPage(homePage)
    } else {
      setOpenTabs(nextTabs)
      if (page === p) {
        const idx = Math.max(0, openTabs.indexOf(p) - 1)
        setPage(nextTabs[idx] ?? nextTabs[0])
      }
    }
    setDirtyPages((prev) => { const n = new Set(prev); n.delete(p); return n })
  }

  function setPageDirty(p: Page, d: boolean) {
    setDirtyPages((prev) => {
      const n = new Set(prev)
      d ? n.add(p) : n.delete(p)
      return n
    })
  }

  const openChat = useCallback((agentId: number, conversationId: number | null) => {
    setChatTarget({ agentId, conversationId })
    navigate('chat')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Tab / Ctrl+Shift+Tab — usa refs para evitar closure stale
  const openTabsRef = useRef(openTabs)
  const pageRef = useRef(page)
  openTabsRef.current = openTabs
  pageRef.current = page

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '\\') { e.preventDefault(); toggleSidebar(); return }
      if (e.ctrlKey && e.shiftKey && e.key === 'E') { e.preventDefault(); navigate('office'); return }
      if (!e.ctrlKey || e.key !== 'Tab') return
      e.preventDefault()
      const tabs = openTabsRef.current
      if (tabs.length <= 1) return
      const idx = tabs.indexOf(pageRef.current)
      const next = e.shiftKey
        ? tabs[(idx - 1 + tabs.length) % tabs.length]
        : tabs[(idx + 1) % tabs.length]
      setPage(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  // ---- CloseContext (Ctrl+B) ----
  const closeHandler = useRef<{ handler: CloseHandler; owner: object } | null>(null)
  const closeApi = useMemo<CloseApi>(() => {
    const closer = createCloser({
      getHandler: () => closeHandler.current?.handler ?? null,
      isHome: () => pageRef.current === homePage,
      goHome: () => navigate(homePage),
      onError: toast.error
    })
    return {
      setHandler: (handler, owner) => {
        if (handler) closeHandler.current = { handler, owner }
        else if (closeHandler.current?.owner === owner) closeHandler.current = null
      },
      requestClose: () => void closer()
    }
  }, [toast.error]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => api.app.onCloseCurrent(closeApi.requestClose), [closeApi])
  useEffect(() => api.pages.onOpen(setOpenPage), [])

  if (!loaded) return <div className="splash">Carregando…</div>

  return (
    <CloseContext.Provider value={closeApi}>
      <div className="app">
        <nav className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="sidebar-header">
            <div className="brand">CH BOTS</div>
            <button
              className="sidebar-toggle"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Expandir barra (Ctrl+\\)' : 'Recolher barra (Ctrl+\\)'}
            >
              {sidebarCollapsed ? '☰' : '«'}
            </button>
          </div>
          {nav.map((n) => (
            <button
              key={n.page}
              className={`nav-item ${page === n.page ? 'active' : ''}`}
              onClick={() => navigate(n.page)}
              title={sidebarCollapsed ? n.label : undefined}
            >
              <span className="nav-icon">{n.icon}</span>
              <span className="nav-label">{n.label}</span>
              {n.page === 'blackbox' && activeCount > 0 && (
                <span className="active-badge">● {activeCount}</span>
              )}
            </button>
          ))}
        </nav>
        <main className="content">
          <TabBar
            tabs={openTabs}
            active={page}
            dirty={dirtyPages}
            onActivate={setPage}
            onClose={closeTab}
          />
          <div className="tab-content">
          <Suspense fallback={<div className="splash">Carregando…</div>}>
            {page === 'chat' && (
              <ChatPage agents={agents} target={chatTarget} onOpenChat={openChat} />
            )}
            {page === 'promptgen' && (
              <PromptGenPage
                agents={agents}
                onGoAgents={() => navigate('agents')}
                onCreateAgent={(draft) => { setAgentDraft(draft); navigate('agents') }}
              />
            )}
            {page === 'agents' && (
              <AgentsPage
                agents={agents}
                providers={providers}
                draft={agentDraft}
                onDraftUsed={() => setAgentDraft(null)}
                onChanged={reloadAgents}
                onOpenChat={(id) => openChat(id, null)}
                onGoSettings={() => navigate('settings')}
              />
            )}
            {page === 'flows' && (
              <FlowsPage
                agents={agents}
                onDirtyChange={(d) => setPageDirty('flows', d)}
              />
            )}
            {page === 'routines' && (
              <RoutinesPage agents={agents} onGoRuns={() => navigate('runs')} />
            )}
            {page === 'runs' && (
              <RunsPage agents={agents} onOpenChat={openChat} />
            )}
            {page === 'blackbox' && (
              <BlackBoxPage agents={agents} />
            )}
            {page === 'office' && <OfficePage onOpenChat={(id) => openChat(id, null)} />}
            {page === 'memory' && <MemoryPage />}
            {page === 'mcp' && <McpPage />}
            {page === 'pages' && <PagesPage onOpen={setOpenPage} />}
            {page === 'settings' && (
              <SettingsPage providers={providers} onProvidersChanged={reloadProviders} />
            )}
          </Suspense>
          </div>
        </main>
        {openPage && (
          <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: '45vw', display: 'flex', flexDirection: 'column', background: 'var(--surface-1, #1e2030)', borderLeft: '1px solid var(--border, #3a3b4a)', zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border, #3a3b4a)', flexShrink: 0 }}>
              <span>{openPage.title}</span>
              <button onClick={() => setOpenPage(null)}>×</button>
            </div>
            <iframe
              srcDoc={openPage.html}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: '100%', flex: 1, border: 'none' }}
              title={openPage.title}
            />
          </div>
        )}
      </div>
    </CloseContext.Provider>
  )
}
