// Descrições amigáveis para a interface. A descrição original do servidor MCP
// continua sendo usada nas chamadas ao modelo.

export const MCP_TOOL_DESCRIPTIONS_PT_BR = {
  // @modelcontextprotocol/server-filesystem
  list_allowed_directories: 'Mostra as pastas que este servidor pode acessar. Subpastas também são acessíveis. Use para saber quais caminhos estão liberados antes de mexer em arquivos.',
  list_directory: 'Lista os arquivos e subpastas de um diretório autorizado.',
  list_directory_with_sizes: 'Lista os arquivos e subpastas de um diretório autorizado, incluindo seus tamanhos.',
  directory_tree: 'Monta uma árvore hierárquica com os arquivos e subpastas de um diretório autorizado.',
  read_file: 'Lê uma parte de um arquivo por linhas, permitindo escolher o início e a quantidade de linhas.',
  read_text_file: 'Lê o conteúdo textual de um arquivo autorizado, com opções para limitar linhas e remover espaços.',
  read_media_file: 'Lê um arquivo de imagem ou áudio e retorna seu conteúdo para inspeção.',
  read_multiple_files: 'Lê vários arquivos autorizados de uma vez e retorna o conteúdo de cada um.',
  write_file: 'Cria ou substitui um arquivo com o conteúdo informado.',
  edit_file: 'Aplica substituições de texto em um arquivo e mostra um resumo das alterações.',
  create_directory: 'Cria um diretório, incluindo os diretórios-pai necessários.',
  move_file: 'Move ou renomeia um arquivo ou diretório dentro dos caminhos autorizados.',
  search_files: 'Procura arquivos e diretórios por nome ou padrão nos caminhos autorizados.',
  get_file_info: 'Mostra informações de um arquivo ou diretório, como tamanho, datas e tipo.',

  // Git MCP servers commonly expose these names.
  git_status: 'Mostra o estado atual do repositório Git e os arquivos modificados.',
  git_diff: 'Mostra as diferenças entre versões ou entre o estado atual e o último commit.',
  git_log: 'Lista o histórico de commits do repositório Git.',
  git_show: 'Mostra os detalhes de um commit, incluindo suas alterações.',
  git_add: 'Adiciona arquivos selecionados à área de preparação do Git.',
  git_commit: 'Cria um commit com as alterações que estão na área de preparação.',
  git_branch: 'Lista, cria ou remove branches do repositório Git.',
  git_checkout: 'Troca de branch ou restaura arquivos para uma versão do Git.',
  git_reset: 'Move o HEAD do Git e, conforme a opção, retira arquivos da área de preparação ou descarta alterações.',
  git_fetch: 'Baixa referências e commits do repositório remoto sem mesclar as alterações.',
  git_pull: 'Baixa alterações do repositório remoto e tenta integrá-las à branch atual.',
  git_push: 'Envia commits locais para o repositório remoto.',
  git_create_branch: 'Cria uma nova branch Git a partir da referência atual.',

  // Context7 MCP.
  'resolve-library-id': 'Encontra o identificador Context7 da biblioteca que corresponde ao nome informado.',
  'get-library-docs': 'Busca documentação atualizada de uma biblioteca usando seu identificador Context7.',

  // Time MCP.
  get_current_time: 'Obtém a data e a hora atuais para um fuso horário informado.',
  convert_time: 'Converte uma data e hora entre dois fusos horários.',

  // Fetch MCP.
  fetch: 'Busca o conteúdo de uma URL e o retorna em um formato que pode ser analisado.',
} as const satisfies Record<string, string>

export type KnownMcpToolName = keyof typeof MCP_TOOL_DESCRIPTIONS_PT_BR

/** Retorna a tradução conhecida ou preserva a descrição original do servidor. */
export function getMcpToolDescriptionPtBr(toolName: string, originalDescription: string): string {
  return MCP_TOOL_DESCRIPTIONS_PT_BR[toolName as KnownMcpToolName] ?? originalDescription
}
