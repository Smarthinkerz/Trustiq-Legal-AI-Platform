import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { PLANS } from '../lib/plans'
import { CHECKLISTS, CURRENCIES, DOCUMENT_TEMPLATES, JURISDICTIONS, PRACTICE_AREAS } from '../services/reference'
import { LIBRARY_KINDS } from './library'

// Public, static reference data used by forms.
const referenceRoutes = new Hono<AppEnv>()

referenceRoutes.get('/', (c) => {
  c.header('cache-control', 'public, max-age=3600')
  return c.json({
    jurisdictions: JURISDICTIONS,
    practice_areas: PRACTICE_AREAS,
    templates: DOCUMENT_TEMPLATES,
    currencies: CURRENCIES,
    plans: PLANS,
    checklists: Object.keys(CHECKLISTS),
    library_kinds: LIBRARY_KINDS
  })
})

export default referenceRoutes
