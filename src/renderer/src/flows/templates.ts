import { defaultNodeData, type FlowGraph } from '@shared/flows'

export interface FlowTemplate {
  name: string
  description: string
  graph: FlowGraph
}

export const flowTemplates: FlowTemplate[] = [
  {
    name: 'Corrigir e resumir',
    description: 'Corrige gramática/ortografia e depois resume em 3 parágrafos.',
    graph: {
      nodes: [
        { id: 't1', type: 'trigger', data: { ...defaultNodeData('trigger'), mode: 'manual', input: '' }, position: { x: 0, y: 80 } },
        { id: 't2', type: 'agent', data: { ...defaultNodeData('agent'), agentId: null, refinePrompt: 'Corrija gramática, ortografia e pontuação do texto.' }, position: { x: 300, y: 40 } },
        { id: 't3', type: 'agent', data: { ...defaultNodeData('agent'), agentId: null, refinePrompt: 'Faça um resumo de até 3 parágrafos do texto recebido.' }, position: { x: 600, y: 40 } },
        { id: 't4', type: 'output', data: { ...defaultNodeData('output'), action: 'save_md', folder: '', fileName: 'correcao-{data}.md', title: '' }, position: { x: 900, y: 80 } }
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2', conditionValue: null },
        { id: 'e2', source: 't2', target: 't3', conditionValue: null },
        { id: 'e3', source: 't3', target: 't4', conditionValue: null }
      ]
    }
  },
  {
    name: 'Ideia → plano',
    description: 'Expande uma ideia e gera um plano de ação numerado.',
    graph: {
      nodes: [
        { id: 'i1', type: 'trigger', data: { ...defaultNodeData('trigger'), mode: 'manual', input: '' }, position: { x: 0, y: 80 } },
        { id: 'i2', type: 'agent', data: { ...defaultNodeData('agent'), agentId: null, refinePrompt: 'Expanda esta ideia, aponte pontos fortes e fracos.' }, position: { x: 300, y: 40 } },
        { id: 'i3', type: 'agent', data: { ...defaultNodeData('agent'), agentId: null, refinePrompt: 'Com base na ideia refinada, crie um plano de ação em etapas numeradas.' }, position: { x: 600, y: 40 } },
        { id: 'i4', type: 'output', data: { ...defaultNodeData('output'), action: 'save_md', folder: '', fileName: 'plano-{data}.md', title: '' }, position: { x: 900, y: 80 } }
      ],
      edges: [
        { id: 'e1', source: 'i1', target: 'i2', conditionValue: null },
        { id: 'e2', source: 'i2', target: 'i3', conditionValue: null },
        { id: 'e3', source: 'i3', target: 'i4', conditionValue: null }
      ]
    }
  },
  {
    name: 'Alerta por palavra',
    description: 'Analisa um texto; se contém ERRO notifica, caso contrário salva.',
    graph: {
      nodes: [
        { id: 'w1', type: 'trigger', data: { ...defaultNodeData('trigger'), mode: 'manual', input: '' }, position: { x: 0, y: 120 } },
        { id: 'w2', type: 'agent', data: { ...defaultNodeData('agent'), agentId: null, refinePrompt: 'Analise o texto. Se encontrar erros, liste-os. Se não houver erros, responda: SEM ERROS.' }, position: { x: 300, y: 120 } },
        { id: 'w3', type: 'condition', data: { ...defaultNodeData('condition'), operator: 'contains', value: 'ERRO', caseSensitive: false }, position: { x: 600, y: 120 } },
        { id: 'w4', type: 'output', data: { ...defaultNodeData('output'), action: 'notify', folder: '', fileName: '', title: 'Atenção: erros encontrados' }, position: { x: 900, y: 40 } },
        { id: 'w5', type: 'output', data: { ...defaultNodeData('output'), action: 'save_md', folder: '', fileName: 'log-ok-{data}.md', title: '' }, position: { x: 900, y: 200 } }
      ],
      edges: [
        { id: 'e1', source: 'w1', target: 'w2', conditionValue: null },
        { id: 'e2', source: 'w2', target: 'w3', conditionValue: null },
        { id: 'e3', source: 'w3', target: 'w4', conditionValue: 'true' },
        { id: 'e4', source: 'w3', target: 'w5', conditionValue: 'false' }
      ]
    }
  },
  {
    name: 'Resumo de notícias',
    description: 'Todo dia às 8h busca notícias de um tema, resume com fontes e salva em .md.',
    graph: {
      nodes: [
        { id: 'n1', type: 'trigger', data: { ...defaultNodeData('trigger'), mode: 'schedule', cron: '0 8 * * *', input: '' }, position: { x: 0, y: 80 } },
        { id: 'n2', type: 'news', data: { ...defaultNodeData('news'), topic: 'inteligência artificial', language: 'pt-BR', count: 10 }, position: { x: 300, y: 80 } },
        { id: 'n3', type: 'agent', data: { ...defaultNodeData('agent'), agentId: null, refinePrompt: 'Use SOMENTE as notícias abaixo. Para cada uma: título, 2 linhas de resumo, fonte, data e link. Depois, 3 tendências que aparecem nelas. Não invente fatos, nomes, estudos ou números. Se algo não está nas notícias, não escreva.\n\n{{entrada}}' }, position: { x: 600, y: 80 } },
        { id: 'n4', type: 'output', data: { ...defaultNodeData('output'), action: 'save_md', folder: '', fileName: 'noticias-{data}.md', title: '' }, position: { x: 900, y: 80 } }
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', conditionValue: null },
        { id: 'e2', source: 'n2', target: 'n3', conditionValue: null },
        { id: 'e3', source: 'n3', target: 'n4', conditionValue: null }
      ]
    }
  }
]
