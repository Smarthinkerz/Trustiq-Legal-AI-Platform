type Level = 'debug' | 'info' | 'warn' | 'error'
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void>

// Structured JSON logs on one line each, which Railway and most log drains index directly.
export function createLogger(minLevel: Level = 'info', silent = false): Logger {
  const emit = (level: Level) => (msg: string, fields: Record<string, unknown> = {}) => {
    if (silent || order[level] < order[minLevel]) return
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }, (_k, v) =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v
    )
    if (level === 'error' || level === 'warn') console.error(line)
    else console.log(line)
  }
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }
}
