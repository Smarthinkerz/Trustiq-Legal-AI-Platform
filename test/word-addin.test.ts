import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { registered, setup } from './helpers'
import { ADDIN_ID } from '../src/pages/word-addin'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => { ctx = await setup() })

const withKey = (key: string) => async (method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` }
  const init: RequestInit = { method, headers }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) { init.body = JSON.stringify(body); headers['content-type'] = 'application/json' }
  const res = await ctx.app.request(`/api/v1${path}`, init)
  return { status: res.status, data: (await res.json()) as any }
}

describe('Word add-in', () => {
  it('serves a manifest that points Word at this server', async () => {
    const res = await ctx.app.request('/addin/manifest.xml')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('xml')
    const xml = await res.text()
    expect(xml).toContain(`<Id>${ADDIN_ID}</Id>`)
    expect(xml).toMatch(/<SourceLocation DefaultValue="https?:\/\/[^"]+\/addin\/taskpane" \/>/)
    expect(xml).toContain('<Permissions>ReadWriteDocument</Permissions>')
    expect(xml).toContain('<Set Name="WordApi" MinVersion="1.3" />')
    // Well formed: every opened element closes.
    const open = (xml.match(/<[A-Za-z][\w:]*(?=[\s>])(?![^>]*\/>)/g) ?? []).length
    const close = (xml.match(/<\/[A-Za-z][\w:]*>/g) ?? []).length
    expect(open).toBe(close)
  })

  it('lets Office frame the pane and load Office.js, and nothing else', async () => {
    const res = await ctx.app.request('/addin/taskpane')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-frame-options')).toBeNull()
    const csp = res.headers.get('content-security-policy')!
    expect(csp).toMatch(/frame-ancestors 'self' https:\/\/\*\.officeapps\.live\.com/)
    expect(csp).toContain("script-src 'self' https://appsforoffice.microsoft.com")
    const html = await res.text()
    expect(html).toContain('https://appsforoffice.microsoft.com/lib/1/hosted/office.js')
    expect(html).toContain('/static/addin/taskpane.js')
    // The app itself still refuses to be framed.
    const app = await ctx.app.request('/app')
    expect(app.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(app.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })

  it('the clause bank is on the public API: read keys insert, write keys add clauses and file documents', async () => {
    const { c } = await registered(ctx.app)
    const read = withKey((await c.post('/api/org/api-keys', { name: 'Word read', access: 'read' })).data.key)
    const write = withKey((await c.post('/api/org/api-keys', { name: 'Word', access: 'read_write' })).data.key)

    const made = await write('POST', '/clauses', { title: 'Governing law', category: 'general', body_en: 'This agreement is governed by the laws of the Sultanate of Oman.', body_ar: 'تخضع هذه الاتفاقية لقوانين سلطنة عمان.' })
    expect(made.status).toBe(201)
    const list = await read('GET', '/clauses?q=governed')
    expect(list.status).toBe(200)
    expect(list.data.items.map((x: any) => x.title)).toEqual(['Governing law'])
    expect((await read('POST', '/clauses', { title: 'Nope', body_en: 'Read keys cannot add clauses.' })).status).toBe(403)
    expect((await write('POST', `/clauses/${made.data.clause.id}/used`)).data.usage_count).toBe(1)

    const k = await write('POST', '/cases', { title: 'Lease dispute', jurisdiction: 'oman' })
    const form = new FormData()
    form.set('file', new File(['Draft settlement agreement.'], 'Settlement.txt', { type: 'text/plain' }))
    form.set('case_id', k.data.case.id)
    const up = await write('POST', '/documents/upload', form)
    expect(up.status).toBe(201)
    expect(up.data.document.case_id).toBe(k.data.case.id)
  })

  it('the pane never writes server text as HTML', () => {
    const js = readFileSync('public/static/addin/taskpane.js', 'utf8')
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  })
})
