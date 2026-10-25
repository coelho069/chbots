import { describe, expect, it } from 'vitest'
import {
  getMcpDescricaoPtBR,
  MCP_DESCRICOES_PT_BR,
} from '../src/shared/mcpDescricoesPtBR'

describe('descrições MCP em pt-BR', () => {
  it('contém exatamente as 14 tools filesystem solicitadas', () => {
    expect(Object.keys(MCP_DESCRICOES_PT_BR)).toEqual([
      'read_file',
      'read_text_file',
      'read_media_file',
      'read_multiple_files',
      'write_file',
      'edit_file',
      'create_directory',
      'list_directory',
      'list_directory_with_sizes',
      'directory_tree',
      'move_file',
      'search_files',
      'get_file_info',
      'list_allowed_directories',
    ])
  })

  it('preserva a descrição original para uma tool desconhecida', () => {
    expect(getMcpDescricaoPtBR('tool_desconhecida', 'Original em inglês'))
      .toBe('Original em inglês')
  })

  it('não altera a descrição original conhecida', () => {
    const original = 'Original em inglês'
    expect(getMcpDescricaoPtBR('read_file', original)).not.toBe(original)
    expect(original).toBe('Original em inglês')
  })
})
