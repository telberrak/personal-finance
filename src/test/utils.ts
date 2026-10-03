import { setLocked } from '../db/crypto';
import { db } from '../db/db';

/** Fresh, empty database for each test. */
export async function resetDb(): Promise<void> {
  setLocked(false); // no key, no encryption
  db.close();
  await db.delete();
  await db.open();
}
