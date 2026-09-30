import pg from 'pg'

// When TEST_DATABASE_URL is set, the suite runs against real PostgreSQL (as in CI) on a clean schema.
export default async function () {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()
}
