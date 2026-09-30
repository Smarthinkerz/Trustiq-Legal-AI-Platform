import { Hono } from 'hono'
import { z } from 'zod'
import { audit, auth, requireRole, type AppEnv } from '../context'
import { notFound } from '../lib/errors'
import { buildUpdate, jsonBody, likePattern, optText, pageSchema, paged, queryParams, uuidParam } from '../lib/http'

const clientFields = {
  kind: z.enum(['individual', 'company']),
  name: z.string().trim().min(2).max(200),
  name_ar: optText(200),
  email: z.string().trim().email().max(254).nullish().or(z.literal('')).transform((v) => v || null),
  phone: optText(60),
  id_number: optText(80),
  address: optText(500),
  notes: optText(5000)
}
const createSchema = z.object({ ...clientFields, kind: clientFields.kind.default('individual') })
const updateSchema = z.object({ ...clientFields, archived: z.boolean() }).partial()
const UPDATABLE = ['kind', 'name', 'name_ar', 'email', 'phone', 'id_number', 'address', 'notes'] as const

const clientsRoutes = new Hono<AppEnv>()

clientsRoutes.get('/', queryParams(z.object({ ...pageSchema, archived: z.enum(['true', 'false']).default('false') })), async (c) => {
  const { org } = auth(c)
  const { page, pageSize, q, archived } = c.req.valid('query')
  const { db } = c.get('deps')
  const params: unknown[] = [org.id]
  let where = `c.org_id = $1 AND c.archived_at IS ${archived === 'true' ? 'NOT ' : ''}NULL`
  if (q) {
    params.push(likePattern(q))
    where += ` AND (c.name ILIKE $${params.length} OR c.name_ar ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.id_number ILIKE $${params.length})`
  }
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM clients c WHERE ${where}`, params)
  const items = await db.query(
    `SELECT c.id, c.kind, c.name, c.name_ar, c.email, c.phone, c.id_number, c.created_at, c.archived_at,
            (SELECT count(*)::int FROM cases k WHERE k.client_id = c.id AND k.status <> 'closed') AS open_cases
       FROM clients c WHERE ${where} ORDER BY c.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize])
  return c.json(paged(items, n, page, pageSize))
})

clientsRoutes.get('/:id', async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const { db } = c.get('deps')
  const client = await db.one('SELECT * FROM clients WHERE id = $1 AND org_id = $2', [id, org.id])
  if (!client) throw notFound('Client')
  const cases = await db.query(
    'SELECT id, reference, title, title_ar, status, priority, jurisdiction, updated_at FROM cases WHERE client_id = $1 AND org_id = $2 ORDER BY updated_at DESC',
    [id, org.id])
  const documents = await db.query(
    'SELECT id, title, doc_type, status, updated_at FROM documents WHERE client_id = $1 AND org_id = $2 ORDER BY updated_at DESC LIMIT 50', [id, org.id])
  return c.json({ client, cases, documents })
})

clientsRoutes.post('/', jsonBody(createSchema), async (c) => {
  const { user, org } = auth(c)
  const b = c.req.valid('json')
  const client = await c.get('deps').db.one(
    `INSERT INTO clients (org_id, kind, name, name_ar, email, phone, id_number, address, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [org.id, b.kind, b.name, b.name_ar, b.email, b.phone, b.id_number, b.address, b.notes, user.id])
  await audit(c, 'client.created', 'client', client!.id)
  return c.json({ client }, 201)
})

clientsRoutes.patch('/:id', jsonBody(updateSchema), async (c) => {
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const b = c.req.valid('json')
  const { sets, values } = buildUpdate(b, UPDATABLE, 3)
  if (b.archived !== undefined) sets.push(`archived_at = ${b.archived ? 'COALESCE(archived_at, now())' : 'NULL'}`)
  const client = await c.get('deps').db.one(
    `UPDATE clients SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, org.id, ...values])
  if (!client) throw notFound('Client')
  await audit(c, 'client.updated', 'client', id, { fields: Object.keys(b) })
  return c.json({ client })
})

clientsRoutes.delete('/:id', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const id = uuidParam(c.req.param('id'), 'Client')
  const rows = await c.get('deps').db.query('DELETE FROM clients WHERE id = $1 AND org_id = $2 RETURNING name', [id, org.id])
  if (!rows.length) throw notFound('Client')
  await audit(c, 'client.deleted', 'client', id, { name: rows[0].name })
  return c.json({ ok: true })
})

export default clientsRoutes
