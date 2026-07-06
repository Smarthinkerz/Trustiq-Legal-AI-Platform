// Simplified database service for TrustiQ
// Matches the archive structure while keeping local/mock behavior.

declare global {
  interface D1Database {
    prepare(query: string): any
    batch(statements: any[]): Promise<any[]>
    exec(query: string): Promise<any>
  }
}

export interface DatabaseBindings {
  DB: D1Database
}

export class UserService {
  constructor(private db: D1Database) {}
  async getAllUsers() { return [] }
}

export class CaseService {
  constructor(private db: D1Database) {}
  async getAllCases() { return [] }
}

export class DocumentService {
  constructor(private db: D1Database) {}
  async getAllDocuments() { return [] }
}

export class BrandingService {
  constructor(private db: D1Database) {}
  async getBrandSettings() { return null }
}

export class ScheduleService {
  constructor(private db: D1Database) {}
  async getEvents() { return [] }
}

export async function initializeDatabase(db: D1Database) {
  return db.exec(`
    CREATE TABLE IF NOT EXISTS placeholder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
}
