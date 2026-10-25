// Conversão entre o formulário de horário da tela de Rotinas e expressões cron.
// Só os padrões gerados aqui voltam para o formulário; o resto vira "custom".

export type Schedule =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; hour: number; minute: number; days: number[] }
  | { kind: 'custom'; cron: string }

export const weekdayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function scheduleToCron(s: Schedule): string {
  switch (s.kind) {
    case 'interval':
      return `*/${s.minutes} * * * *`
    case 'daily':
      return `${s.minute} ${s.hour} * * *`
    case 'weekly': {
      const days = [...new Set(s.days)].sort((a, b) => a - b)
      return `${s.minute} ${s.hour} * * ${days.join(',')}`
    }
    case 'custom':
      return s.cron.trim()
  }
}

const num = (v: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  return n >= min && n <= max ? n : null
}

export function cronToSchedule(cron: string): Schedule {
  const parts = cron.trim().split(/\s+/)
  const custom: Schedule = { kind: 'custom', cron: cron.trim() }
  if (parts.length !== 5) return custom
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string]

  const interval = /^\*\/(\d+)$/.exec(m)
  if (interval && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    const minutes = num(interval[1]!, 1, 59)
    return minutes === null ? custom : { kind: 'interval', minutes }
  }

  const minute = num(m, 0, 59)
  const hour = num(h, 0, 23)
  if (minute === null || hour === null || dom !== '*' || mon !== '*') return custom
  if (dow === '*') return { kind: 'daily', hour, minute }

  const days = dow.split(',').map((d) => num(d, 0, 6))
  if (days.some((d) => d === null)) return custom
  return { kind: 'weekly', hour, minute, days: days as number[] }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function describeSchedule(cron: string): string {
  const s = cronToSchedule(cron)
  switch (s.kind) {
    case 'interval':
      return s.minutes === 1 ? 'A cada minuto' : `A cada ${s.minutes} minutos`
    case 'daily':
      return `Todo dia às ${pad(s.hour)}:${pad(s.minute)}`
    case 'weekly':
      return `${s.days.map((d) => weekdayLabels[d]).join(', ')} às ${pad(s.hour)}:${pad(s.minute)}`
    case 'custom':
      return `cron: ${s.cron}`
  }
}
