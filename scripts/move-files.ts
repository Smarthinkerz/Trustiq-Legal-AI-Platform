import { loadConfig } from '../src/config'
import { createDb } from '../src/db'
import { createS3Store, moveFiles } from '../src/services/storage'

// Moves uploaded files between PostgreSQL and the S3-compatible store configured with STORAGE_DRIVER=s3.
//   npx tsx scripts/move-files.ts to-store    copy files out of the database, then clear them there
//   npx tsx scripts/move-files.ts to-db       bring files back into the database
// Take a database backup first. Safe to stop and run again; each file is moved once.
async function main() {
  const direction = process.argv[2]
  if (direction !== 'to-store' && direction !== 'to-db') throw new Error('Usage: npx tsx scripts/move-files.ts to-store|to-db')
  const config = loadConfig()
  if (!config.storage.s3) throw new Error('Set STORAGE_DRIVER=s3 and the S3_* variables first.')
  const db = await createDb(config)
  const moved = await moveFiles(db, createS3Store(config.storage.s3), direction, { log: (m) => console.log(m) })
  console.log(`Done: ${moved} file(s) moved ${direction === 'to-store' ? 'to the object store' : 'into the database'}.`)
  await db.close()
}
main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
