import { beforeAll, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { guessMapping, parseAmount, parseDate, parseJurisdiction } from '../src/services/bulk-import'
import { parseSpreadsheet, readCsv } from '../src/services/spreadsheet'
import { registered, setup } from './helpers'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

// A minimal real .xlsx: shared strings, an inline string, a number and an Excel serial date.
function xlsx(rows: (string | number)[][]): Uint8Array {
  const shared: string[] = []
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const col = (i: number) => String.fromCharCode(65 + i)
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
    if (ci === 1 && ri > 0) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
    shared.push(v)
    return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`
  }).join('')}</row>`).join('')
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Clients" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`)
  })
}

const upload = (c: any, path: string, type: string, name: string, bytes: Uint8Array | string, extra: Record<string, string> = {}) => {
  const form = new FormData()
  form.set('type', type)
  form.set('file', new File([bytes as any], name))
  for (const [k, v] of Object.entries(extra)) form.set(k, v)
  return c.raw('POST', path, form)
}

describe('spreadsheet parsing', () => {
  it('reads CSV with quotes, semicolons and Arabic, and real xlsx workbooks', () => {
    expect(readCsv('Name;Notes\n"Al Noor, LLC";"said ""hi"""\r\nأحمد;')).toEqual([['Name', 'Notes'], ['Al Noor, LLC', 'said "hi"'], ['أحمد', '']])
    const rows = parseSpreadsheet(xlsx([['Name', 'Arabic name', 'Opened'], ['Gulf Trading LLC', 'شركة الخليج', 46280]]), 'c.xlsx')
    expect(rows).toEqual([['Name', 'Arabic name', 'Opened'], ['Gulf Trading LLC', 'شركة الخليج', '46280']])
    expect(() => parseSpreadsheet(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'old.xls')).toThrow(/xlsx or CSV/)
  })

  it('understands regional dates, amounts, jurisdictions and Arabic headers', () => {
    expect(parseDate('15/09/2026')).toBe('2026-09-15')
    expect(parseDate('٢٠٢٦-٠٨-٠١')).toBe('2026-08-01')
    expect(parseDate('46280')).toBe('2026-09-15')
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseAmount('12,500.000 OMR')).toBe(12500)
    expect(parseAmount('١٢٬٥٠٠٫٥')).toBe(12500.5)
    expect(parseJurisdiction('سلطنة عُمان')).toBe('oman')
    expect(parseJurisdiction('Dubai')).toBe('uae')
    expect(parseJurisdiction('المملكة العربية السعودية')).toBe('ksa')
    expect(parseJurisdiction('Atlantis')).toBeNull()
    expect(guessMapping('cases', ['رقم القضية', 'موضوع الدعوى', 'اسم الموكل', 'المحكمة', 'الحالة'])).toMatchObject({ court_number: 0, title: 1, client: 2, court: 3, status: 4, currency: null })
  })
})

describe('bulk import', () => {
  it('previews and imports clients from Excel, skipping duplicates', async () => {
    const { c } = await registered(ctx.app)
    await c.post('/api/clients', { name: 'Existing Client', email: 'exists@firm.test' })
    const file = xlsx([
      ['Client name', 'Arabic name', 'Email', 'Mobile', 'Civil ID'],
      ['Gulf Trading LLC', 'شركة الخليج للتجارة', 'legal@gulf.test', '٩٩٠٠٠٠٠٠', '123'],
      ['Ahmed Al Balushi', 'أحمد البلوشي', 'not-an-email', '', ''],
      ['Someone Else', '', 'EXISTS@firm.test', '', ''],
      ['', 'بلا اسم إنجليزي', '', '', '']
    ])
    const preview = await upload(c, '/api/import/preview', 'clients', 'clients.xlsx', file)
    expect(preview.status).toBe(200)
    expect(preview.data).toMatchObject({ total: 4, valid: 3, missing: [] })
    expect(preview.data.mapping).toMatchObject({ name: 0, name_ar: 1, email: 2, phone: 3, id_number: 4 })
    expect(preview.data.sample[0].values).toMatchObject({ kind: 'company', phone: '99000000' })
    expect(preview.data.problems.find((p: any) => p.row === 3).warnings[0]).toMatch(/Email/)

    const done = await upload(c, '/api/import', 'clients', 'clients.xlsx', file)
    expect(done.status).toBe(200)
    expect(done.data).toMatchObject({ created: 2, skipped_count: 2 })
    expect(done.data.skipped).toEqual([{ row: 4, reason: 'Already exists' }, { row: 5, reason: 'Name is missing' }])
    const list = (await c.get('/api/clients?q=Gulf')).data.items
    expect(list[0]).toMatchObject({ name: 'Gulf Trading LLC', name_ar: 'شركة الخليج للتجارة', kind: 'company' })
    // Importing the same file again creates nothing new.
    expect((await upload(c, '/api/import', 'clients', 'clients.xlsx', file)).data.created).toBe(0)
  })

  it('imports cases from an Arabic CSV, linking or creating clients', async () => {
    const { c } = await registered(ctx.app)
    await c.post('/api/clients', { name: 'شركة الخليج للتجارة' })
    const csv = '\ufeffموضوع الدعوى,اسم الموكل,الدولة,المحكمة,رقم القضية,الحالة,تاريخ القيد,قيمة المطالبة\n' +
      'مطالبة بفواتير غير مسددة,شركة الخليج للتجارة,سلطنة عمان,المحكمة الابتدائية بمسقط,123/2026,جارية,15/09/2026,"12,500.000"\n' +
      'نزاع عمالي,موكل جديد,الإمارات,,,منتهية,٠١/٠٢/٢٠٢٥,\n' +
      'قضية بلا دولة معروفة,,أتلانتس,,,,,\n'
    const preview = await upload(c, '/api/import/preview', 'cases', 'cases.csv', csv)
    expect(preview.data.problems.find((p: any) => p.row === 4).warnings[0]).toMatch(/Jurisdiction/)
    const done = await upload(c, '/api/import', 'cases', 'cases.csv', csv)
    expect(done.status).toBe(200)
    expect(done.data).toMatchObject({ created: 3, clients_created: 1, skipped_count: 0 })
    const cases = (await c.get('/api/cases?pageSize=10')).data.items
    const unpaid = cases.find((k: any) => k.title === 'مطالبة بفواتير غير مسددة')
    const full = (await c.get(`/api/cases/${unpaid.id}`)).data.case
    expect(full).toMatchObject({ jurisdiction: 'oman', court: 'المحكمة الابتدائية بمسقط', status: 'active', currency: 'OMR' })
    expect(Number(full.estimated_value)).toBe(12500)
    expect(full.description).toContain('123/2026')
    expect(String(full.opened_on).slice(0, 10)).toBe('2026-09-15')
    expect(full.reference).toMatch(/^2026-/)
    const labour = cases.find((k: any) => k.title === 'نزاع عمالي')
    expect(labour).toMatchObject({ status: 'closed', jurisdiction: 'uae' })
    // Re-importing skips cases that already exist.
    expect((await upload(c, '/api/import', 'cases', 'cases.csv', csv)).data).toMatchObject({ created: 0, skipped_count: 3 })
  })

  it('requires a title column, accepts a manual column mapping and offers templates', async () => {
    const { c } = await registered(ctx.app)
    const bad = await upload(c, '/api/import', 'cases', 'x.csv', 'Client,Court\nA,B\n')
    expect(bad.status).toBe(400)
    expect(bad.data.error.message).toMatch(/title/)
    const mapped = await upload(c, '/api/import', 'cases', 'x.csv', 'Client,Court\nAcme Dispute,B\n', { mapping: JSON.stringify({ title: 0, court: 1 }) })
    expect(mapped.data.created).toBe(1)
    const tpl = await ctx.app.request('/api/import/template/cases', { headers: { cookie: c.cookie } })
    expect(tpl.status).toBe(200)
    const bytes = new Uint8Array(await tpl.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM so Excel shows Arabic.
    const body = new TextDecoder().decode(bytes)
    expect(body.startsWith('Title,Client')).toBe(true)
    expect(body).toContain('مطالبة عمالية')
    expect((await upload(c, '/api/import', 'widgets', 'x.csv', 'a\nb\n')).status).toBe(400)
  })
})
