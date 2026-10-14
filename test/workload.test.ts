import { beforeAll, describe, expect, it } from 'vitest'
import { client, registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

async function member(owner: any, name: string, role: 'lawyer' | 'staff') {
  const inv = await owner.post('/api/org/invites', { email: `${role}-${crypto.randomUUID().slice(0, 6)}@firm.test`, role })
  const c = client(ctx.app)
  await c.post('/api/auth/accept-invite', { token: new URL(inv.data.invite_url.replace('#', '')).searchParams.get('token'), name, password: 'Str0ngPassw0rd' })
  const me = (await c.get('/api/auth/me')).data
  return { c, id: me.user.id as string }
}

// A time on a given Gulf day (days from today), as an ISO string.
const at = (days: number, hour: number) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
  return new Date(Date.parse(`${today}T${String(hour).padStart(2, '0')}:00:00+04:00`) + days * 86_400_000).toISOString()
}

describe('team workload', () => {
  it('counts each person\'s next two weeks, finds court clashes and hands work over', async () => {
    const { c: owner, me } = await registered(ctx.app)
    const sara = await member(owner, 'Sara', 'lawyer')
    const omar = await member(owner, 'Omar', 'staff')

    const k1 = (await owner.post('/api/cases', { title: 'Supply dispute', jurisdiction: 'oman', court: 'Primary Court, Muscat', assigned_to: sara.id })).data.case
    const k2 = (await owner.post('/api/cases', { title: 'Labour claim', jurisdiction: 'oman', court: 'Primary Court, Sohar', assigned_to: sara.id })).data.case
    // Two hearings on the same day in different courts: a clash for Sara.
    const h1 = (await owner.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k1.id, starts_at: at(2, 9) })).data.event
    await owner.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k2.id, starts_at: at(2, 11) })
    await owner.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k1.id, starts_at: at(20, 9) })
    await owner.post('/api/events', { title: 'Statement of defence', kind: 'deadline', case_id: k1.id, starts_at: at(-1, 12) })
    const task = (await owner.post('/api/tasks', { title: 'Translate the contract', case_id: k1.id, assigned_to: sara.id, due_date: at(-2, 12).slice(0, 10) })).data.task
    await owner.post('/api/billing/time', { case_id: k1.id, work_date: at(-3, 12).slice(0, 10), minutes: 90, description: 'Drafting' })
    // A hearing nobody is responsible for.
    const k3 = (await owner.post('/api/cases', { title: 'Unassigned', jurisdiction: 'oman' })).data.case
    await ctx.db.query('UPDATE cases SET assigned_to = NULL WHERE id = $1', [k3.id])
    await owner.post('/api/events', { title: 'Hearing', kind: 'hearing', case_id: k3.id, starts_at: at(3, 9) })
    await ctx.db.query(`UPDATE events SET created_by = NULL WHERE case_id = $1`, [k3.id])

    const w = await owner.get('/api/workload')
    expect(w.status).toBe(200)
    expect(w.data.days).toHaveLength(14)
    const s = w.data.members.find((m: any) => m.id === sara.id)
    expect(s).toMatchObject({ open_matters: 2, hearings: 2, overdue_deadlines: 1, open_tasks: 1, overdue_tasks: 1 })
    expect(s.per_day[2]).toBe(2)
    expect(s.clashes).toHaveLength(1)
    expect(s.clashes[0].hearings.map((x: any) => x.place).sort()).toEqual(['Primary Court, Muscat', 'Primary Court, Sohar'])
    expect(w.data).toMatchObject({ clashes: 1, unassigned_hearings: 1 })
    expect(w.data.members.find((m: any) => m.id === me.user.id)).toMatchObject({ hours_30d: 1.5 })

    // Hand the morning hearing and the task to Omar: the clash disappears.
    const items = await owner.get(`/api/workload/${sara.id}`)
    expect(items.data.hearings).toHaveLength(2)
    expect(items.data.tasks[0]).toMatchObject({ id: task.id, overdue: true })
    expect((await owner.post('/api/workload/reassign', { kind: 'hearing', id: h1.id, to: omar.id })).data.to.name).toBe('Omar')
    await owner.post('/api/workload/reassign', { kind: 'task', id: task.id, to: omar.id })
    const after = await owner.get('/api/workload')
    expect(after.data.members.find((m: any) => m.id === sara.id)).toMatchObject({ hearings: 1, clashes: [], overdue_tasks: 0 })
    expect(after.data.members.find((m: any) => m.id === omar.id)).toMatchObject({ hearings: 1, overdue_tasks: 1 })
    const act = await ctx.db.query(`SELECT body FROM case_activity WHERE case_id = $1 AND kind = 'assignment' ORDER BY created_at`, [k1.id])
    expect(act.map((a: any) => a.body)).toEqual(['Hearing "Hearing" handed to Omar', 'Task "Translate the contract" handed to Omar'])

    // Lawyers may move hearings and tasks but not matters; staff see only themselves.
    expect((await sara.c.post('/api/workload/reassign', { kind: 'matter', id: k1.id, to: omar.id })).status).toBe(403)
    expect((await owner.post('/api/workload/reassign', { kind: 'matter', id: k1.id, to: omar.id })).status).toBe(200)
    const staffView = await omar.c.get('/api/workload')
    expect(staffView.data.members.map((m: any) => m.id)).toEqual([omar.id])
    expect((await omar.c.get(`/api/workload/${sara.id}`)).status).toBe(403)
    expect((await omar.c.post('/api/workload/reassign', { kind: 'task', id: task.id, to: sara.id })).status).toBe(403)
    const other = await registered(ctx.app)
    expect((await other.c.post('/api/workload/reassign', { kind: 'task', id: task.id, to: sara.id })).status).toBe(400)
  })
})
