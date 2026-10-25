import cron from 'node-cron'
import { describe, expect, it } from 'vitest'
import { cronToSchedule, describeSchedule, scheduleToCron, type Schedule } from '../src/shared/schedule'

describe('horários', () => {
  const cases: [Schedule, string][] = [
    [{ kind: 'interval', minutes: 15 }, '*/15 * * * *'],
    [{ kind: 'daily', hour: 8, minute: 5 }, '5 8 * * *'],
    [{ kind: 'weekly', hour: 18, minute: 30, days: [5, 1, 3] }, '30 18 * * 1,3,5']
  ]

  it.each(cases)('converte %o em cron válido e volta', (schedule, expected) => {
    const expr = scheduleToCron(schedule)
    expect(expr).toBe(expected)
    expect(cron.validate(expr)).toBe(true)
    const back = cronToSchedule(expr)
    expect(back.kind).toBe(schedule.kind)
    expect(scheduleToCron(back)).toBe(expected)
  })

  it('trata outros padrões como cron personalizado', () => {
    expect(cronToSchedule('0 9 1 * *')).toEqual({ kind: 'custom', cron: '0 9 1 * *' })
    expect(cronToSchedule('*/90 * * * *').kind).toBe('custom')
    expect(cronToSchedule('lixo').kind).toBe('custom')
  })

  it('descreve em português', () => {
    expect(describeSchedule('5 8 * * *')).toBe('Todo dia às 08:05')
    expect(describeSchedule('*/1 * * * *')).toBe('A cada minuto')
    expect(describeSchedule('0 9 * * 1,5')).toBe('Seg, Sex às 09:00')
  })
})
