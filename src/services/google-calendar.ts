import { createHash } from 'node:crypto'
import type { Config } from '../config'
import type { Db, Queryable } from '../db'
import type { Logger } from '../lib/logger'
import { open, seal } from '../lib/secret-box'

// ---------------------------------------------------------------------------
// One-way sync of the firm calendar into each lawyer's Google Calendar.
// TrustiqLegal creates its own "TrustiqLegal" calendar in the user's account
// (scope calendar.app.created) and only ever touches that calendar.
// ---------------------------------------------------------------------------

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://www.googleapis.com/calendar/v3'
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created']

const WINDOW_PAST_DAYS = 30
const WINDOW_FUTURE_DAYS = 400
const MAX_CHANGES_PER_RUN = 400

export type GoogleDeps = { db: Db; config: Config; log: Logger; fetch?: typeof fetch }

export class GoogleError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message) }
}

export const redirectUri = (config: Config) => `${config.appUrl}/api/integrations/google/callback`
const secretOf = (config: Config) => config.encryptionKey ?? config.google!.clientSecret

export function authorizationUrl(config: Config, state: string): string {
  const q = new URLSearchParams({
    client_id: config.google!.clientId,
    redirect_uri: redirectUri(config),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  })
  return `${AUTH_URL}?${q}`
}

async function tokenRequest(d: GoogleDeps, params: Record<string, string>) {
  const res = await (d.fetch ?? fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: d.config.google!.clientId, client_secret: d.config.google!.clientSecret, ...params }).toString()
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new GoogleError(data.error_description || data.error || `Google sign-in failed (HTTP ${res.status})`, res.status, data.error)
  return data as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string }
}

// The ID token comes straight from Google's token endpoint over TLS, so its claims can be read without re-verifying the signature.
const idTokenEmail = (idToken?: string) => {
  try { return idToken ? (JSON.parse(Buffer.from(idToken.split('.')[1]!, 'base64url').toString('utf8')).email as string) ?? null : null } catch { return null }
}

export async function connectWithCode(d: GoogleDeps, user: { id: string; org_id: string }, code: string) {
  const t = await tokenRequest(d, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(d.config) })
  if (!t.refresh_token) throw new GoogleError('Google did not grant offline access. Remove TrustiqLegal from your Google account permissions and connect again.', 400)
  if (!(t.scope ?? '').includes('calendar.app.created')) throw new GoogleError('Calendar access was not granted. Connect again and allow TrustiqLegal to manage its calendar.', 400, 'scope')
  const secret = secretOf(d.config)
  await d.db.query(
    `INSERT INTO calendar_connections (user_id, org_id, account_email, refresh_token, access_token, access_expires_at, needs_sync)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6), true)
     ON CONFLICT (user_id) DO UPDATE SET account_email = EXCLUDED.account_email, refresh_token = EXCLUDED.refresh_token,
       access_token = EXCLUDED.access_token, access_expires_at = EXCLUDED.access_expires_at, needs_sync = true, last_error = NULL`,
    [user.id, user.org_id, idTokenEmail(t.id_token), seal(t.refresh_token, secret), seal(t.access_token, secret), t.expires_in - 60])
  return { email: idTokenEmail(t.id_token) }
}

type Conn = { user_id: string; org_id: string; refresh_token: string; access_token: string | null; access_expires_at: Date | null; calendar_id: string | null }

async function accessToken(d: GoogleDeps, conn: Conn): Promise<string> {
  const secret = secretOf(d.config)
  if (conn.access_token && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now()) {
    const tok = open(conn.access_token, secret)
    if (tok) return tok
  }
  const refresh = open(conn.refresh_token, secret)
  if (!refresh) throw new GoogleError('The saved Google connection can no longer be read. Disconnect and connect again.', 401, 'invalid_grant')
  const t = await tokenRequest(d, { grant_type: 'refresh_token', refresh_token: refresh })
  await d.db.query(`UPDATE calendar_connections SET access_token = $2, access_expires_at = now() + make_interval(secs => $3) WHERE user_id = $1`,
    [conn.user_id, seal(t.access_token, secret), t.expires_in - 60])
  return t.access_token
}

async function api(d: GoogleDeps, token: string, method: string, path: string, body?: unknown) {
  const res = await (d.fetch ?? fetch)(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 204) return null
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new GoogleError(data?.error?.message || `Google Calendar error (HTTP ${res.status})`, res.status)
  return data
}

// ---------------- What to sync ----------------

const KIND_COLORS: Record<string, string> = { hearing: '11', deadline: '5', filing: '3', meeting: '9', reminder: '8' }
const KIND_ICON: Record<string, string> = { hearing: '⚖ ', deadline: '⏰ ', filing: '⏰ ' }
const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

export async function desiredItems(db: Queryable, userId: string, orgId: string, appUrl: string) {
  const [events, tasks] = await Promise.all([
    db.query(
      `SELECT e.id, e.title, e.kind, e.starts_at, e.ends_at, e.all_day, e.location, e.notes, k.reference, k.title AS case_title
         FROM events e LEFT JOIN cases k ON k.id = e.case_id
        WHERE e.org_id = $1 AND e.starts_at BETWEEN now() - make_interval(days => $2) AND now() + make_interval(days => $3)
        ORDER BY e.starts_at LIMIT 3000`, [orgId, WINDOW_PAST_DAYS, WINDOW_FUTURE_DAYS]),
    db.query(
      `SELECT t.id, t.title, to_char(t.due_date, 'YYYY-MM-DD') AS due, k.reference FROM tasks t LEFT JOIN cases k ON k.id = t.case_id
        WHERE t.org_id = $1 AND t.assigned_to = $2 AND t.status <> 'done' AND t.due_date IS NOT NULL
          AND t.due_date >= CURRENT_DATE - $3::int`, [orgId, userId, WINDOW_PAST_DAYS])
  ])
  const items = new Map<string, Record<string, unknown>>()
  for (const e of events) {
    const start = new Date(e.starts_at)
    const description = [
      e.reference && `${e.reference}${e.case_title ? ` – ${e.case_title}` : ''}`,
      e.notes,
      `${appUrl}/app#/calendar`
    ].filter(Boolean).join('\n\n')
    const date = start.toISOString().slice(0, 10)
    items.set(`event:${e.id}`, {
      summary: `${KIND_ICON[e.kind] ?? ''}${e.title}${e.reference ? ` (${e.reference})` : ''}`,
      description,
      location: e.location ?? undefined,
      start: e.all_day ? { date } : { dateTime: start.toISOString() },
      end: e.all_day ? { date: dayAfter(date) } : { dateTime: (e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 3600_000)).toISOString() },
      colorId: KIND_COLORS[e.kind],
      reminders: ['hearing', 'deadline', 'filing'].includes(e.kind)
        ? { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }, { method: 'popup', minutes: 120 }] }
        : { useDefault: true },
      extendedProperties: { private: { trustiq: `event:${e.id}` } }
    })
  }
  for (const t of tasks) {
    items.set(`task:${t.id}`, {
      summary: `☑ ${t.title}${t.reference ? ` (${t.reference})` : ''}`,
      description: `${appUrl}/app#/tasks`,
      start: { date: t.due }, end: { date: dayAfter(t.due) },
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { trustiq: `task:${t.id}` } }
    })
  }
  return items
}

const hashOf = (body: unknown) => createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 32)

// ---------------- Sync ----------------

export async function syncConnection(d: GoogleDeps, userId: string): Promise<{ created: number; updated: number; deleted: number; pending: boolean }> {
  const { db, config } = d
  const conn = await db.one<Conn & { org_name: string }>(
    `SELECT c.*, o.name AS org_name FROM calendar_connections c JOIN organizations o ON o.id = c.org_id
       JOIN users u ON u.id = c.user_id WHERE c.user_id = $1 AND u.deactivated_at IS NULL`, [userId])
  if (!conn) return { created: 0, updated: 0, deleted: 0, pending: false }
  const stats = { created: 0, updated: 0, deleted: 0, pending: false }
  try {
    const token = await accessToken(d, conn)
    let calendarId = conn.calendar_id
    if (calendarId) {
      // The user may have deleted the calendar in Google; start again if so.
      try { await api(d, token, 'GET', `/calendars/${encodeURIComponent(calendarId)}`) } catch (err) {
        if (err instanceof GoogleError && (err.status === 404 || err.status === 410)) calendarId = null
        else throw err
      }
    }
    if (!calendarId) {
      const cal = await api(d, token, 'POST', '/calendars', { summary: `TrustiqLegal – ${conn.org_name}`, description: 'Hearings, deadlines and tasks from TrustiqLegal. Changes made here are overwritten.' })
      calendarId = cal.id as string
      await db.query('UPDATE calendar_connections SET calendar_id = $2 WHERE user_id = $1', [userId, calendarId])
      await db.query('DELETE FROM calendar_sync_items WHERE user_id = $1', [userId])
    }
    const cal = `/calendars/${encodeURIComponent(calendarId)}/events`
    const desired = await desiredItems(db, userId, conn.org_id, config.appUrl)
    const synced = new Map((await db.query<{ item_key: string; remote_id: string; hash: string }>(
      'SELECT item_key, remote_id, hash FROM calendar_sync_items WHERE user_id = $1', [userId])).map((r) => [r.item_key, r]))
    let budget = MAX_CHANGES_PER_RUN

    for (const [key, body] of desired) {
      if (budget <= 0) { stats.pending = true; break }
      const hash = hashOf(body)
      const prev = synced.get(key)
      if (prev?.hash === hash) continue
      budget--
      let remoteId = prev?.remote_id
      if (prev) {
        try {
          await api(d, token, 'PUT', `${cal}/${encodeURIComponent(prev.remote_id)}`, body)
          stats.updated++
        } catch (err) {
          if (!(err instanceof GoogleError && (err.status === 404 || err.status === 410))) throw err
          remoteId = undefined
        }
      }
      if (!remoteId) {
        const created = await api(d, token, 'POST', cal, body)
        remoteId = created.id as string
        stats.created++
      }
      await db.query(
        `INSERT INTO calendar_sync_items (user_id, item_key, remote_id, hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, item_key) DO UPDATE SET remote_id = EXCLUDED.remote_id, hash = EXCLUDED.hash`, [userId, key, remoteId, hash])
    }
    for (const [key, prev] of synced) {
      if (desired.has(key)) continue
      if (budget-- <= 0) { stats.pending = true; break }
      try { await api(d, token, 'DELETE', `${cal}/${encodeURIComponent(prev.remote_id)}`) } catch (err) {
        if (!(err instanceof GoogleError && (err.status === 404 || err.status === 410))) throw err
      }
      await db.query('DELETE FROM calendar_sync_items WHERE user_id = $1 AND item_key = $2', [userId, key])
      stats.deleted++
    }
    await db.query(`UPDATE calendar_connections SET last_synced_at = now(), last_error = NULL, needs_sync = needs_sync OR $2, sync_started_at = NULL WHERE user_id = $1`, [userId, stats.pending])
    return stats
  } catch (err) {
    const message = err instanceof GoogleError
      ? (err.code === 'invalid_grant' ? 'Google access was revoked or expired. Connect Google Calendar again.' : err.message)
      : 'Could not reach Google Calendar.'
    d.log.warn('google calendar sync failed', { userId, err })
    await db.query(`UPDATE calendar_connections SET last_error = $2, sync_started_at = NULL WHERE user_id = $1`, [userId, message.slice(0, 500)])
    throw err
  }
}

// Background worker: syncs connections whose firm calendar changed, plus a periodic refresh.
// Each connection is claimed atomically so several app instances never sync the same one at once.
export async function runCalendarSync(d: GoogleDeps, { max = 20 } = {}) {
  if (!d.config.google) return 0
  let done = 0
  while (done < max) {
    const [claimed] = await d.db.query<{ user_id: string }>(
      `UPDATE calendar_connections SET sync_started_at = now(), needs_sync = false
        WHERE user_id = (
          SELECT user_id FROM calendar_connections
           WHERE (sync_started_at IS NULL OR sync_started_at < now() - interval '10 minutes')
             AND (last_error IS NULL OR last_error NOT LIKE 'Google access was revoked%')
             AND (needs_sync OR last_synced_at IS NULL OR last_synced_at < now() - interval '1 hour')
           ORDER BY needs_sync DESC, last_synced_at NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING user_id`)
    if (!claimed) break
    await syncConnection(d, claimed.user_id).catch(() => {})
    done++
  }
  return done
}

// Syncs one user now unless another sync of the same connection is already running.
export async function syncNow(d: GoogleDeps, userId: string) {
  const claimed = await d.db.one(
    `UPDATE calendar_connections SET sync_started_at = now(), needs_sync = false
      WHERE user_id = $1 AND (sync_started_at IS NULL OR sync_started_at < now() - interval '10 minutes') RETURNING user_id`, [userId])
  if (!claimed) return null
  return syncConnection(d, userId)
}

// Called after the firm calendar or a task changes.
export const markCalendarsDirty = (db: Queryable, orgId: string) =>
  db.query('UPDATE calendar_connections SET needs_sync = true WHERE org_id = $1', [orgId])

export async function disconnect(d: GoogleDeps, userId: string, { removeCalendar = true } = {}) {
  const conn = await d.db.one<Conn>('SELECT * FROM calendar_connections WHERE user_id = $1', [userId])
  if (!conn) return false
  try {
    const token = await accessToken(d, conn)
    if (removeCalendar && conn.calendar_id) await api(d, token, 'DELETE', `/calendars/${encodeURIComponent(conn.calendar_id)}`).catch(() => {})
    const refresh = open(conn.refresh_token, secretOf(d.config))
    if (refresh) await (d.fetch ?? fetch)(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {})
  } catch (err) {
    d.log.warn('google disconnect cleanup failed', { userId, err })
  }
  await d.db.query('DELETE FROM calendar_connections WHERE user_id = $1', [userId])
  return true
}
