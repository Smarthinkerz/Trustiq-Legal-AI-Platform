import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { PLANS } from '../lib/plans'
import { CURRENCIES, DOCUMENT_TEMPLATES, JURISDICTIONS, PRACTICE_AREAS } from '../services/reference'

// Public, static reference data used by forms.
const referenceRoutes = new Hono<AppEnv>()

referenceRoutes.get('/', (c) => {
  c.header('cache-control', 'public, max-age=3600')
  return c.json({
    jurisdictions: JURISDICTIONS,
    practice_areas: PRACTICE_AREAS,
    templates: DOCUMENT_TEMPLATES,
    currencies: CURRENCIES,
    plans: PLANS
  })
})

export default referenceRoutes
