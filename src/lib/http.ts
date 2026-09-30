import { zValidator } from '@hono/zod-validator'
import { z, type ZodType } from 'zod'
import { badRequest } from './errors'

const formatIssues = (issues: z.core.$ZodIssue[]) => issues.map((i) => ({ path: i.path.join('.'), message: i.message }))

export const jsonBody = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result) => {
    if (!result.success) throw badRequest('Please check the highlighted fields.', formatIssues(result.error.issues))
  })

export const queryParams = <T extends ZodType>(schema: T) =>
  zValidator('query', schema, (result) => {
    if (!result.success) throw badRequest('Invalid query parameters.', formatIssues(result.error.issues))
  })

export const uuidParam = (value: string, what = 'Resource') => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw badRequest(`Invalid ${what.toLowerCase()} id`)
  return value
}

export const pageSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional()
}

export const paged = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize })

// Escapes LIKE wildcards in user search input.
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`

// Optional text fields: '' from HTML forms becomes null.
export const optText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null))

export const optUuid = z.string().uuid().nullish().or(z.literal('')).transform((v) => (v ? v : null))

// Builds "col = $n" assignments for PATCH handlers from a whitelist of provided keys.
export function buildUpdate(data: Record<string, unknown>, allowed: readonly string[], startIndex = 1) {
  const sets: string[] = []
  const values: unknown[] = []
  for (const key of allowed) {
    if (data[key] !== undefined) {
      values.push(data[key])
      sets.push(`${key} = $${startIndex + values.length - 1}`)
    }
  }
  return { sets, values }
}
