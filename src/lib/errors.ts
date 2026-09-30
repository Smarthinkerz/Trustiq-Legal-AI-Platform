import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message)
export const forbidden = (message = 'You do not have permission to perform this action') => new HttpError(403, 'forbidden', message)
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`)
export const conflict = (message: string) => new HttpError(409, 'conflict', message)
export const paymentRequired = (code: string, message: string) => new HttpError(402, code, message)
export const tooMany = (message = 'Too many requests. Please try again shortly.') => new HttpError(429, 'rate_limited', message)
export const unavailable = (code: string, message: string) => new HttpError(503, code, message)
