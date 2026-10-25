// Cada item roda uma vez; a posição no array é a versão (PRAGMA user_version).
export const migrations: string[] = [
  `
  CREATE TABLE providers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK (kind IN ('openai', 'anthropic', 'ollama')),
    name       TEXT NOT NULL,
    base_url   TEXT NOT NULL,
    key_ref    TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE agents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    color         TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    provider_id   INTEGER NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    model         TEXT NOT NULL,
    temperature   REAL NOT NULL DEFAULT 0.7,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    origin     TEXT NOT NULL CHECK (origin IN ('manual', 'handoff', 'routine')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_conversations_agent ON conversations(agent_id, updated_at);

  CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    content         TEXT NOT NULL,
    from_agent_id   INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

  CREATE TABLE routines (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    cron            TEXT NOT NULL,
    source_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    task_prompt     TEXT NOT NULL,
    target_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    handoff_prompt  TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_run_at     TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE routine_runs (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id             INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    started_at             TEXT NOT NULL,
    finished_at            TEXT,
    status                 TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    source_conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    target_conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    error                  TEXT
  );
  CREATE INDEX idx_runs_routine ON routine_runs(routine_id, started_at);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: Fluxos visuais
  `
  CREATE TABLE flows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE flow_nodes (
    id         TEXT PRIMARY KEY,
    flow_id    INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('trigger', 'agent', 'condition', 'output')),
    data_json  TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL
  );
  CREATE INDEX idx_flow_nodes_flow ON flow_nodes(flow_id);

  CREATE TABLE flow_edges (
    id              TEXT PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    source_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    target_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    condition_value TEXT CHECK (condition_value IN ('true', 'false'))
  );
  CREATE INDEX idx_flow_edges_flow ON flow_edges(flow_id);

  CREATE TABLE flow_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id     INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    trigger     TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule')),
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    path_json   TEXT NOT NULL DEFAULT '[]',
    error       TEXT
  );
  CREATE INDEX idx_flow_runs_flow ON flow_runs(flow_id, started_at);

  -- node_id sem FK: o histórico sobrevive à edição do fluxo
  CREATE TABLE flow_run_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
    node_id     TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),
    input       TEXT NOT NULL DEFAULT '',
    output      TEXT,
    error       TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX idx_flow_steps_run ON flow_run_steps(run_id);
  `,
  // 3: nó "Buscar notícias". O SQLite não altera CHECK: recria flow_nodes. As ligações são
  // guardadas antes, porque apagar flow_nodes apagaria flow_edges em cascata.
  `
  CREATE TABLE flow_nodes_new (
    id         TEXT PRIMARY KEY,
    flow_id    INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('trigger', 'news', 'agent', 'condition', 'output')),
    data_json  TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL
  );
  INSERT INTO flow_nodes_new SELECT id, flow_id, type, data_json, position_x, position_y FROM flow_nodes ORDER BY rowid;

  CREATE TABLE flow_edges_bak AS SELECT * FROM flow_edges ORDER BY rowid;
  DROP TABLE flow_edges;
  DROP TABLE flow_nodes;
  ALTER TABLE flow_nodes_new RENAME TO flow_nodes;
  CREATE INDEX idx_flow_nodes_flow ON flow_nodes(flow_id);

  CREATE TABLE flow_edges (
    id              TEXT PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    source_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    target_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    condition_value TEXT CHECK (condition_value IN ('true', 'false'))
  );
  INSERT INTO flow_edges SELECT id, flow_id, source_node, target_node, condition_value FROM flow_edges_bak;
  DROP TABLE flow_edges_bak;
  CREATE INDEX idx_flow_edges_flow ON flow_edges(flow_id);
  `,
  // 4: Gerador de Prompts (histórico) e nó "Gerador de Prompt". Mesma recriação de flow_nodes da versão 3.
  `
  CREATE TABLE prompts_gerados (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ideia_original  TEXT NOT NULL,
    ideia_corrigida TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    caracteres      INTEGER NOT NULL,
    agente_id       INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    criado_em       TEXT NOT NULL
  );
  CREATE INDEX idx_prompts_gerados_criado ON prompts_gerados(criado_em);

  CREATE TABLE flow_nodes_new (
    id         TEXT PRIMARY KEY,
    flow_id    INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('trigger', 'news', 'promptgen', 'agent', 'condition', 'output')),
    data_json  TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL
  );
  INSERT INTO flow_nodes_new SELECT id, flow_id, type, data_json, position_x, position_y FROM flow_nodes ORDER BY rowid;

  CREATE TABLE flow_edges_bak AS SELECT * FROM flow_edges ORDER BY rowid;
  DROP TABLE flow_edges;
  DROP TABLE flow_nodes;
  ALTER TABLE flow_nodes_new RENAME TO flow_nodes;
  CREATE INDEX idx_flow_nodes_flow ON flow_nodes(flow_id);

  CREATE TABLE flow_edges (
    id              TEXT PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    source_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    target_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    condition_value TEXT CHECK (condition_value IN ('true', 'false'))
  );
  INSERT INTO flow_edges SELECT id, flow_id, source_node, target_node, condition_value FROM flow_edges_bak;
  DROP TABLE flow_edges_bak;
  CREATE INDEX idx_flow_edges_flow ON flow_edges(flow_id);
  `,
  // 5: Memória dos agentes + nó "Memória" nos fluxos.
  `
  CREATE TABLE memoria_categorias (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    cor  TEXT NOT NULL DEFAULT '#888888'
  );

  CREATE TABLE memoria_fatos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fato          TEXT NOT NULL,
    categoria     TEXT NOT NULL,
    confianca     INTEGER NOT NULL DEFAULT 50,
    status        TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','conflito','arquivado')),
    confirmacoes  INTEGER NOT NULL DEFAULT 1,
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE memoria_fontes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    fato_id    INTEGER NOT NULL REFERENCES memoria_fatos(id) ON DELETE CASCADE,
    fonte      TEXT NOT NULL,
    tipo       TEXT NOT NULL CHECK (tipo IN ('usuario','arquivo','site','modelo','conversa')),
    data_fonte TEXT,
    trecho     TEXT,
    criado_em  TEXT NOT NULL
  );
  CREATE INDEX idx_memoria_fontes_fato ON memoria_fontes(fato_id);

  CREATE VIRTUAL TABLE memoria_fatos_fts USING fts5(
    fato, categoria,
    content=memoria_fatos,
    content_rowid=id
  );

  CREATE TRIGGER memoria_fatos_ai AFTER INSERT ON memoria_fatos BEGIN
    INSERT INTO memoria_fatos_fts(rowid, fato, categoria) VALUES (new.id, new.fato, new.categoria);
  END;
  CREATE TRIGGER memoria_fatos_ad AFTER DELETE ON memoria_fatos BEGIN
    INSERT INTO memoria_fatos_fts(memoria_fatos_fts, rowid, fato, categoria) VALUES('delete', old.id, old.fato, old.categoria);
  END;
  CREATE TRIGGER memoria_fatos_au AFTER UPDATE OF fato, categoria ON memoria_fatos BEGIN
    INSERT INTO memoria_fatos_fts(memoria_fatos_fts, rowid, fato, categoria) VALUES('delete', old.id, old.fato, old.categoria);
    INSERT INTO memoria_fatos_fts(rowid, fato, categoria) VALUES (new.id, new.fato, new.categoria);
  END;

  INSERT INTO memoria_categorias(nome, cor) VALUES
    ('Pessoas','#4f86c6'),('Projetos','#6ab04c'),('Infra/Servidores','#f0932b'),
    ('Segurança','#e55039'),('Notícias','#8e44ad'),('Preferências','#16a085'),
    ('Tarefas','#f39c12'),('Outros','#95a5a6');

  CREATE TABLE flow_nodes_new (
    id         TEXT PRIMARY KEY,
    flow_id    INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('trigger','news','promptgen','agent','condition','output','memory')),
    data_json  TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL
  );
  INSERT INTO flow_nodes_new SELECT id, flow_id, type, data_json, position_x, position_y FROM flow_nodes ORDER BY rowid;

  CREATE TABLE flow_edges_bak AS SELECT * FROM flow_edges ORDER BY rowid;
  DROP TABLE flow_edges;
  DROP TABLE flow_nodes;
  ALTER TABLE flow_nodes_new RENAME TO flow_nodes;
  CREATE INDEX idx_flow_nodes_flow ON flow_nodes(flow_id);

  CREATE TABLE flow_edges (
    id              TEXT PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    source_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    target_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    condition_value TEXT CHECK (condition_value IN ('true','false'))
  );
  INSERT INTO flow_edges SELECT id, flow_id, source_node, target_node, condition_value FROM flow_edges_bak;
  DROP TABLE flow_edges_bak;
  CREATE INDEX idx_flow_edges_flow ON flow_edges(flow_id);
  `,
  // 6: Índices de performance nas colunas mais consultadas.
  `
  CREATE INDEX IF NOT EXISTS idx_messages_conv_created  ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_conversations_updated   ON conversations(agent_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_routine_runs_started    ON routine_runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_flow_runs_started       ON flow_runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_flow_steps_status       ON flow_run_steps(run_id, status);
  CREATE INDEX IF NOT EXISTS idx_memoria_fatos_cat_status ON memoria_fatos(categoria, status);
  CREATE INDEX IF NOT EXISTS idx_memoria_fatos_confianca  ON memoria_fatos(confianca DESC);
  `,
  // 7: Ligações entre fatos e posições de layout do grafo de memória.
  `
  CREATE TABLE memoria_ligacoes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    origem_id  INTEGER NOT NULL REFERENCES memoria_fatos(id) ON DELETE CASCADE,
    destino_id INTEGER NOT NULL REFERENCES memoria_fatos(id) ON DELETE CASCADE,
    tipo       TEXT NOT NULL CHECK (tipo IN ('mesma_fonte','mesma_entidade','similar','conflito','manual')),
    peso       REAL NOT NULL DEFAULT 1.0,
    criado_em  TEXT NOT NULL,
    UNIQUE(origem_id, destino_id)
  );
  CREATE INDEX idx_ligacoes_origem  ON memoria_ligacoes(origem_id);
  CREATE INDEX idx_ligacoes_destino ON memoria_ligacoes(destino_id);

  CREATE TABLE memoria_node_positions (
    fato_id    INTEGER PRIMARY KEY REFERENCES memoria_fatos(id) ON DELETE CASCADE,
    x          REAL NOT NULL,
    y          REAL NOT NULL,
    updated_em TEXT NOT NULL
  );
  `,
  // 8: Grupos por consulta e configurações do Grafo de Memória.
  `
  CREATE TABLE memoria_graph_groups (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT NOT NULL,
    consulta  TEXT NOT NULL,
    cor       TEXT NOT NULL DEFAULT '#888888',
    criado_em TEXT NOT NULL
  );

  CREATE TABLE memoria_graph_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 9: Delegação de tarefas entre bots + nó "Delegar" nos fluxos.
  `
  CREATE TABLE agent_delegation_config (
    agent_id         INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    pode_delegar     INTEGER NOT NULL DEFAULT 0,
    pode_receber     INTEGER NOT NULL DEFAULT 1,
    destinos_json    TEXT NOT NULL DEFAULT '[]',
    max_profundidade INTEGER NOT NULL DEFAULT 2,
    max_por_resposta INTEGER NOT NULL DEFAULT 3
  );

  CREATE TABLE delegacoes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    conversa_id    INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    bot_origem_id  INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    bot_destino_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tarefa         TEXT NOT NULL,
    resposta       TEXT,
    status         TEXT NOT NULL CHECK (status IN ('running','ok','error')),
    profundidade   INTEGER NOT NULL DEFAULT 0,
    iniciado_em    TEXT NOT NULL,
    finalizado_em  TEXT,
    erro           TEXT
  );
  CREATE INDEX idx_delegacoes_conversa ON delegacoes(conversa_id, iniciado_em DESC);

  CREATE TABLE flow_nodes_new (
    id         TEXT PRIMARY KEY,
    flow_id    INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('trigger','news','promptgen','agent','condition','output','memory','delegate')),
    data_json  TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL
  );
  INSERT INTO flow_nodes_new SELECT id, flow_id, type, data_json, position_x, position_y FROM flow_nodes ORDER BY rowid;

  CREATE TABLE flow_edges_bak AS SELECT * FROM flow_edges ORDER BY rowid;
  DROP TABLE flow_edges;
  DROP TABLE flow_nodes;
  ALTER TABLE flow_nodes_new RENAME TO flow_nodes;
  CREATE INDEX idx_flow_nodes_flow ON flow_nodes(flow_id);

  CREATE TABLE flow_edges (
    id              TEXT PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    source_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    target_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    condition_value TEXT CHECK (condition_value IN ('true','false'))
  );
  INSERT INTO flow_edges SELECT id, flow_id, source_node, target_node, condition_value FROM flow_edges_bak;
  DROP TABLE flow_edges_bak;
  CREATE INDEX idx_flow_edges_flow ON flow_edges(flow_id);
  `,
  // 10: Cache de respostas LLM + campo usar_cache por agente.
  // 11: Ferramentas MCP por agente + tabela mcp_calls para caixa-preta.
  // (migrations 10 e 11 separadas abaixo para manter a ordem dos índices)
  `
  CREATE TABLE cache_respostas (
    chave_hash  TEXT PRIMARY KEY,
    provedor    TEXT NOT NULL,
    modelo      TEXT NOT NULL,
    resposta    TEXT NOT NULL,
    tokens_in   INTEGER NOT NULL DEFAULT 0,
    tokens_out  INTEGER NOT NULL DEFAULT 0,
    criado_em   TEXT NOT NULL,
    expira_em   TEXT NOT NULL,
    hits        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_cache_expira ON cache_respostas(expira_em);

  ALTER TABLE agents ADD COLUMN usar_cache INTEGER NOT NULL DEFAULT 0;
  `,
  // 11: Ferramentas MCP por agente + registro de chamadas na caixa-preta.
  `
  ALTER TABLE agents ADD COLUMN mcp_tools TEXT NOT NULL DEFAULT '[]';

  CREATE TABLE mcp_calls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    server_name   TEXT NOT NULL,
    tool_name     TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('ok', 'error', 'denied')),
    duration_ms   INTEGER,
    error         TEXT,
    started_at    TEXT NOT NULL
  );
  CREATE INDEX idx_mcp_calls_started ON mcp_calls(started_at DESC);
  `,
  // 12: Aprovações por ferramenta MCP por agente.
  `
  CREATE TABLE mcp_approvals (
    agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    server_name TEXT NOT NULL,
    tool_name   TEXT NOT NULL,
    approval    TEXT NOT NULL CHECK (approval IN ('ask','allow','block')),
    PRIMARY KEY (agent_id, server_name, tool_name)
  );
  `,
  // 13: Nó "Ferramenta MCP" nos fluxos.
  `
  CREATE TABLE flow_nodes_new (
    id         TEXT PRIMARY KEY,
    flow_id    INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('trigger','news','promptgen','agent','condition','output','memory','delegate','mcp-tool')),
    data_json  TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL
  );
  INSERT INTO flow_nodes_new SELECT id, flow_id, type, data_json, position_x, position_y FROM flow_nodes ORDER BY rowid;

  CREATE TABLE flow_edges_bak AS SELECT * FROM flow_edges ORDER BY rowid;
  DROP TABLE flow_edges;
  DROP TABLE flow_nodes;
  ALTER TABLE flow_nodes_new RENAME TO flow_nodes;
  CREATE INDEX idx_flow_nodes_flow ON flow_nodes(flow_id);

  CREATE TABLE flow_edges (
    id              TEXT PRIMARY KEY,
    flow_id         INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    source_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    target_node     TEXT NOT NULL REFERENCES flow_nodes(id) ON DELETE CASCADE,
    condition_value TEXT CHECK (condition_value IN ('true','false'))
  );
  INSERT INTO flow_edges SELECT id, flow_id, source_node, target_node, condition_value FROM flow_edges_bak;
  DROP TABLE flow_edges_bak;
  CREATE INDEX idx_flow_edges_flow ON flow_edges(flow_id);
  `,
  // 14: Traduções pt-BR em cache para descrições de ferramentas MCP.
  `
  CREATE TABLE mcp_tool_translations (
    tool_name              TEXT NOT NULL,
    original_description   TEXT NOT NULL,
    translated_description TEXT NOT NULL,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    PRIMARY KEY (tool_name, original_description)
  );
  `,
  // 15: Traduções automáticas por servidor, incluindo a versão do inputSchema.
  `
  CREATE TABLE mcp_tool_translations_auto (
    server_name              TEXT NOT NULL,
    tool_name                TEXT NOT NULL,
    original_hash            TEXT NOT NULL,
    original_description     TEXT NOT NULL,
    original_input_schema   TEXT NOT NULL,
    translated_description   TEXT NOT NULL,
    translated_input_schema  TEXT NOT NULL,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL,
    PRIMARY KEY (server_name, tool_name, original_hash)
  );
  CREATE INDEX idx_mcp_tool_translations_auto_tool
    ON mcp_tool_translations_auto(server_name, tool_name);
  `,
  // 16: Aviso só quando resultado mudar.
  `
ALTER TABLE routines ADD COLUMN last_output_hash TEXT;
ALTER TABLE routines ADD COLUMN notify_only_when_changed INTEGER NOT NULL DEFAULT 0;
`
]
