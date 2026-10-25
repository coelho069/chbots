import { describe, expect, it } from 'vitest'
import { getMcpToolDescriptionPtBr, MCP_TOOL_DESCRIPTIONS_PT_BR } from '../src/shared/mcpToolDescriptions'

describe('descrições pt-BR das tools MCP', () => {
  it('inclui as tools do servidor filesystem', () => {
    const names = [
      'list_allowed_directories', 'list_directory', 'list_directory_with_sizes', 'directory_tree',
      'read_file', 'read_text_file', 'read_media_file', 'read_multiple_files', 'write_file',
      'edit_file', 'create_directory', 'move_file', 'search_files', 'get_file_info',
    ]

    for (const name of names) expect(MCP_TOOL_DESCRIPTIONS_PT_BR[name as keyof typeof MCP_TOOL_DESCRIPTIONS_PT_BR]).toBeTruthy()
  })

  it('inclui as tools dos servidores git, context7, time e fetch', () => {
    for (const name of ['git_status', 'resolve-library-id', 'get-library-docs', 'get_current_time', 'convert_time', 'fetch']) {
      expect(getMcpToolDescriptionPtBr(name, 'Original em inglês')).not.toBe('Original em inglês')
    }
  })

  it('preserva a descrição original para tools desconhecidas', () => {
    expect(getMcpToolDescriptionPtBr('tool_nova', 'Original em inglês')).toBe('Original em inglês')
  })
})
