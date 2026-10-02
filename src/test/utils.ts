import { db } from '../db/db';

/** Fresh, empty database for each test. */
export async function resetDb(): Promise<void> {
  db.close();
  await db.delete();
  await db.open();
}
