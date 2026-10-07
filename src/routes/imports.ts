import { Hono } from 'hono'
import { audit, auth, requireRole, type AppEnv, type Ctx } from '../context'
import { badRequest, paymentRequired } from '../lib/errors'
import { buildRows, caseKey, existingClients, guessMapping, IMPORT_FIELDS, templateCsv, type ImportType } from '../services/bulk-import'
import { SpreadsheetError, parseSpreadsheet } from '../services/spreadsheet'
import { planOf } from '../lib/plans'
import { usageThisMonth } from '../services/usage'
import { caseActivity } from './cases'

const MAX_FILE = 10 * 1024 * 1024

const importsRoutes = new Hono<AppEnv>()

const importType = (v: unknown): ImportType => {
  if (v === 'clients' || v === 'cases') return v
  throw badRequest('Choose whether to import clients or cases.')
}

// Reads the uploaded sheet and the column mapping (explicit, or guessed from the header row).
async function readUpload(c: Ctx) {
  const form = await c.req.formData().catch(() => { throw badRequest('Expected a multipart form upload.') })
  const type = importType(form.get('type'))
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) throw badRequest('Choose an Excel (.xlsx) or CSV file.')
  if (file.size > MAX_FILE) throw badRequest('The file is larger than 10 MB.')
  let rows: string[][]
  try {
    rows = parseSpreadsheet(new Uint8Array(await file.arrayBuffer()), file.name)
  } catch (err) {
    if (err instanceof SpreadsheetError) throw badRequest(err.message)
    throw err
  }
  if (rows.length < 2) throw badRequest('The sheet needs a header row and at least one row of data.')
  const headers = rows[0]!
  let mapping = guessMapping(type, headers)
  const rawMapping = form.get('mapping')
  if (typeof rawMapping === 'string' && rawMapping) {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(rawMapping) } catch { throw badRequest('The column mapping is not valid.') }
    mapping = Object.fromEntries(IMPORT_FIELDS[type].map((f) => {
      const v = parsed[f.key]
      return [f.key, typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < headers.length ? v : null]
    }))
  }
  const missing = IMPORT_FIELDS[type].filter((f) => f.required && mapping[f.key] == null).map((f) => f.key)
  return { form, type, headers, data: rows.slice(1), mapping, missing }
}

importsRoutes.get('/template/:type', (c) => {
  const type = importType(c.req.param('type'))
  c.header('content-type', 'text/csv; charset=utf-8')
  c.header('content-disposition', `attachment; filename="trustiq-${type}-template.csv"`)
  return c.body(templateCsv(type))
})

importsRoutes.post('/preview', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { org } = auth(c)
  const { type, headers, data, mapping, missing } = await readUpload(c)
  const results = buildRows(type, data, mapping, { jurisdiction: org.default_jurisdiction, currency: org.default_currency })
  return c.json({
    type, headers, mapping, missing,
    fields: IMPORT_FIELDS[type].map((f) => ({ key: f.key, required: !!f.required })),
    total: results.length,
    valid: results.filter((r) => !r.errors.length).length,
    sample: results.slice(0, 15),
    problems: results.filter((r) => r.errors.length || r.warnings.length).slice(0, 100).map(({ row, errors, warnings }) => ({ row, errors, warnings }))
  })
})

importsRoutes.post('/', async (c) => {
  requireRole(c, 'owner', 'admin', 'lawyer')
  const { user, org } = auth(c)
  const { db } = c.get('deps')
  const { form, type, data, mapping, missing } = await readUpload(c)
  if (missing.length) throw badRequest(`Choose the column for: ${missing.join(', ')}.`)
  const createClients = form.get('create_missing_clients') !== 'false'
  const results = buildRows(type, data, mapping, { jurisdiction: org.default_jurisdiction, currency: org.default_currency })
  const valid = results.filter((r) => !r.errors.length)
  const skipped: { row: number; reason: string }[] = results.filter((r) => r.errors.length).map((r) => ({ row: r.row, reason: r.errors.join('; ') }))

  if (type === 'cases') {
    // Respect the plan's open-case limit for the whole file before writing anything.
    const limit = planOf(org).maxActiveCases
    const opening = valid.filter((r) => r.values.status !== 'closed').length
    if (limit !== null) {
      const u = await usageThisMonth(db, org.id)
      if (u.active_cases + opening > limit) {
        throw paymentRequired('plan_limit_cases', `This file opens ${opening} cases but your plan allows ${limit} open cases (${u.active_cases} in use). Mark finished cases as closed in the sheet, or upgrade your plan.`)
      }
    }
  }

  let created = 0
  let clientsCreated = 0
  await db.tx(async (q) => {
    const clients = await existingClients(q, org.id)
    if (type === 'clients') {
      for (const r of valid) {
        if (clients.find(r.values)) { skipped.push({ row: r.row, reason: 'Already exists' }); continue }
        const v = r.values
        const row = await q.one(
          `INSERT INTO clients (org_id, kind, name, name_ar, email, phone, id_number, address, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [org.id, v.kind, v.name, v.name_ar, v.email, v.phone, v.id_number, v.address, v.notes, user.id])
        clients.add(row!.id, v)
        created++
      }
      return
    }
    const existingCases = new Set((await q.query<{ title: string; client_id: string | null }>('SELECT title, client_id FROM cases WHERE org_id = $1', [org.id])).map((k) => caseKey(k.title, k.client_id)))
    for (const r of valid) {
      const v = r.values
      let clientId: string | null = null
      if (v.client) {
        clientId = clients.find({ name: v.client }) ?? null
        if (!clientId && createClients) {
          const row = await q.one(`INSERT INTO clients (org_id, kind, name, created_by) VALUES ($1, 'individual', $2, $3) RETURNING id`, [org.id, v.client, user.id])
          clientId = row!.id
          clients.add(clientId!, { name: v.client })
          clientsCreated++
        }
      }
      const key = caseKey(v.title, clientId)
      if (existingCases.has(key)) { skipped.push({ row: r.row, reason: 'Already exists' }); continue }
      existingCases.add(key)
      const seq = await q.one('UPDATE organizations SET case_seq = case_seq + 1 WHERE id = $1 RETURNING case_seq', [org.id])
      const year = String(v.opened_on ?? new Date().toISOString()).slice(0, 4)
      const reference = `${year}-${String(seq!.case_seq).padStart(4, '0')}`
      const row = await q.one(
        `INSERT INTO cases (org_id, reference, title, title_ar, client_id, practice_area, jurisdiction, court, opposing_party, status, priority,
                            description, estimated_value, currency, assigned_to, opened_on, closed_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16::date, CURRENT_DATE), CASE WHEN $10 = 'closed' THEN CURRENT_DATE END, $15) RETURNING id`,
        [org.id, reference, v.title, v.title_ar, clientId, v.practice_area, v.jurisdiction, v.court, v.opposing_party, v.status, v.priority,
         v.description, v.estimated_value, v.currency, user.id, v.opened_on])
      await caseActivity(q, org.id, row!.id, user.id, 'created', 'Case imported from a spreadsheet')
      created++
    }
  })
  await audit(c, `${type === 'clients' ? 'client' : 'case'}.imported`, undefined, undefined, { created, clients_created: clientsCreated, skipped: skipped.length })
  skipped.sort((a, b) => a.row - b.row)
  return c.json({ type, created, clients_created: clientsCreated, skipped: skipped.slice(0, 500), skipped_count: skipped.length })
})

export default importsRoutes
