import { beforeAll, describe, expect, it } from 'vitest'
import { calculateDeadline, fromHijri, toHijri } from '../src/services/deadlines'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

describe('deadline calculator', () => {
  it('converts between Gregorian and Hijri (Umm al-Qura) dates', () => {
    expect(toHijri('2026-10-04')).toEqual({ year: 1448, month: 4, day: 23 })
    expect(fromHijri({ year: 1448, month: 4, day: 23 })).toBe('2026-10-04')
    expect(toHijri('2025-03-01')).toEqual({ year: 1446, month: 9, day: 1 }) // 1 Ramadan 1446
    for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2030, 0, 1); t += 86_400_000 * 7) {
      const d = new Date(t).toISOString().slice(0, 10)
      expect(fromHijri(toHijri(d))).toBe(d)
    }
  })

  it('counts days, months and working days and moves off weekends and holidays', () => {
    // 30 days from Sunday 4 Oct 2026 is Tuesday 3 Nov: a working day in Oman.
    expect(calculateDeadline({ start: '2026-10-04', amount: 30, unit: 'days', jurisdiction: 'oman' })).toMatchObject({ due: '2026-11-03', skipped_days: 0 })
    // Lands on Friday 6 Nov in Oman (Fri–Sat weekend) → Sunday 8 Nov.
    const oman = calculateDeadline({ start: '2026-10-07', amount: 30, unit: 'days', jurisdiction: 'oman' })
    expect(oman).toMatchObject({ unadjusted: '2026-11-06', due: '2026-11-08', skipped_days: 2 })
    expect(oman.steps.map((s) => s.code)).toEqual(['counted', 'weekend', 'weekend'])
    // The same date in the UAE (Sat–Sun weekend) stays on Friday.
    expect(calculateDeadline({ start: '2026-10-07', amount: 30, unit: 'days', jurisdiction: 'uae' }).due).toBe('2026-11-06')
    // Holidays push it further, and are named.
    const hol = calculateDeadline({ start: '2026-10-07', amount: 30, unit: 'days', jurisdiction: 'oman', holidays: [{ date: '2026-11-08', name: 'National Day' }] })
    expect(hol.due).toBe('2026-11-09')
    expect(hol.steps.at(-1)).toEqual({ code: 'holiday', date: '2026-11-08', name: 'National Day' })
    // Month ends clamp: 31 Jan + 1 month = 28 Feb (Saturday in the UAE) → Monday 2 Mar.
    expect(calculateDeadline({ start: '2026-01-31', amount: 1, unit: 'months', jurisdiction: 'uae' })).toMatchObject({ unadjusted: '2026-02-28', due: '2026-03-02' })
    // Hijri months: 23 Rabi' II + 2 months = 23 Jumada II.
    const hijri = calculateDeadline({ start: '2026-10-04', amount: 2, unit: 'months', calendar: 'hijri', jurisdiction: 'ksa', rollForward: false })
    expect(hijri.due_hijri).toEqual({ year: 1448, month: 6, day: 23 })
    // Working days skip the weekend and holidays; the start day is not counted.
    expect(calculateDeadline({ start: '2026-10-08', amount: 3, unit: 'working_days', jurisdiction: 'oman', holidays: [{ date: '2026-10-11', name: 'Closure' }] }).due).toBe('2026-10-14')
  })

  it('calculates through the API with the firm\'s holidays, which only staff can manage', async () => {
    const { c } = await registered(ctx.app)
    const add = await c.post('/api/deadlines/holidays', { date: '2026-11-08', name: 'National Day', jurisdiction: 'oman' })
    expect(add.status).toBe(201)
    expect((await c.post('/api/deadlines/holidays', { date: '2026-11-08', name: 'Again', jurisdiction: 'oman' })).status).toBe(400)
    await c.post('/api/deadlines/holidays', { date: '2026-11-09', name: 'UAE only', jurisdiction: 'uae' })

    const res = await c.post('/api/deadlines/calculate', { start: '2026-10-07', amount: 30, unit: 'days', jurisdiction: 'oman' })
    expect(res.status).toBe(200)
    expect(res.data.result).toMatchObject({ due: '2026-11-09', due_hijri: { year: 1448, month: 5 } })
    expect(res.data.weekend).toEqual([5, 6])
    expect((await c.post('/api/deadlines/calculate', { start: '2026-02-30', amount: 1, unit: 'days', jurisdiction: 'oman' })).status).toBe(400)

    const list = await c.get('/api/deadlines/holidays?year=2026')
    expect(list.data.items.map((h: any) => h.name)).toEqual(['National Day', 'UAE only'])
    // Another firm sees none of them.
    const other = await registered(ctx.app)
    expect((await other.c.get('/api/deadlines/holidays')).data.items).toHaveLength(0)
    expect((await other.c.del(`/api/deadlines/holidays/${add.data.holiday.id}`)).status).toBe(404)
    expect((await c.del(`/api/deadlines/holidays/${add.data.holiday.id}`)).status).toBe(200)
    // Clients of the portal cannot reach it.
    expect((await client(ctx.app).post('/api/deadlines/calculate', { start: '2026-10-07', amount: 1, unit: 'days', jurisdiction: 'oman' })).status).toBe(401)
  })
})
