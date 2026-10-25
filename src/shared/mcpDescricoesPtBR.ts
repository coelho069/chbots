/**
 * Descrições pt-BR para as tools conhecidas do servidor MCP filesystem.
 *
 * A descrição original da tool permanece separada e deve continuar sendo
 * enviada ao modelo nas chamadas MCP.
 */
export const MCP_DESCRICOES_PT_BR = {
  read_file: 'Lê um arquivo inteiro como texto. OBSOLETO: use read_text_file.',
  read_text_file: 'Lê um arquivo de texto. Use head para ler só as primeiras N linhas ou tail para as últimas. Só funciona nas pastas liberadas.',
  read_media_file: 'Lê imagem ou áudio e devolve em base64 com o tipo do arquivo. Só nas pastas liberadas.',
  read_multiple_files: 'Lê vários arquivos de uma vez; se um falhar, os outros continuam. Só nas pastas liberadas.',
  write_file: 'Cria ou SOBRESCREVE um arquivo sem avisar. Use com cuidado. Só nas pastas liberadas.',
  edit_file: 'Edita linhas de um arquivo de texto e mostra a diferença (diff). Só nas pastas liberadas.',
  create_directory: 'Cria uma pasta (e subpastas, se preciso). Se já existir, não dá erro.',
  list_directory: 'Lista arquivos [FILE] e pastas [DIR] de um caminho.',
  list_directory_with_sizes: 'Lista arquivos e pastas com o tamanho de cada um.',
  directory_tree: 'Mostra a árvore de pastas e arquivos.',
  move_file: 'Move ou renomeia arquivos e pastas.',
  search_files: 'Procura arquivos e pastas pelo nome.',
  get_file_info: 'Mostra detalhes de um arquivo (tamanho, datas, permissões).',
  list_allowed_directories: 'Mostra as pastas que este servidor pode acessar (subpastas incluídas).',
} as const

export type McpToolComDescricaoPtBR = keyof typeof MCP_DESCRICOES_PT_BR

/** Retorna a tradução conhecida ou preserva a descrição original da tool. */
export function getMcpDescricaoPtBR(toolName: string, descricaoOriginal: string): string {
  return MCP_DESCRICOES_PT_BR[toolName as McpToolComDescricaoPtBR] ?? descricaoOriginal
}
