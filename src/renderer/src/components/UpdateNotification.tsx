import { useEffect } from 'react'
import { useToast } from '../toast'

export function UpdateNotification() {
  const toast = useToast()

  useEffect(() => {
    toast.info('✨ Atualizado: loadHistory() adicionado ao agent. Histórico de conversas agora carrega do banco.')
  }, [toast])

  return null
}
