/**
 * The sync API contract, shared by the server (server/) and the app (src/sync/).
 * Everything under /api. Authenticated calls send `Authorization: Bearer <session token>`.
 */

/** Version of this API contract. Bump it when a change would break apps already installed. */
export const API_VERSION = 1;

/** Limits the server enforces; the app keeps under them. */
export const LIMITS = {
  changesPerPush: 500,
  changesPerPull: 500,
  /** Characters of one encrypted record (base64). Attachments are the largest records. */
  blobChars: 4 * 1024 * 1024,
  /** Characters of all records in one push, kept under the server's request limit. */
  pushChars: 6 * 1024 * 1024,
  /** Characters of the encrypted vault envelope. */
  envelopeChars: 4096,
  deviceNameChars: 80,
} as const;

/** A sync account. The email is the only readable personal data on the server. */
export interface User {
  id: string;
  email: string;
}

/** Returned on sign-in: the bearer token for this device, its id, and the account. */
export interface Session {
  token: string;
  user: User;
  deviceId: string;
}

/** A signed-in device, as listed under Settings → Sync and devices. */
export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

/** A passkey registered for signing in to the sync account (not the on-device app lock). */
export interface AccountPasskey {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** GET /me: the account, its devices and passkeys, and whether a vault (wrapped sync key) exists yet. */
export interface Me {
  user: User;
  devices: Device[];
  passkeys: AccountPasskey[];
  hasVault: boolean;
}

/** POST /api/auth/email/start */
export interface EmailStart {
  email: string;
}
/** POST /api/auth/email/verify → Session */
export interface EmailVerify {
  email: string;
  code: string;
  deviceName: string;
}

/** A change to one record. `blob` null means the record was deleted. */
export interface Change {
  rkey: string;
  blob: string | null;
}

/** POST /api/sync/push */
export interface PushRequest {
  changes: Change[];
}
/** POST /sync/push: the sequence number after the push, used to skip pulling back our own changes. */
export interface PushResponse {
  seq: number;
}

/** GET /api/sync/pull?since=<seq> */
export interface PullResponse {
  changes: (Change & { seq: number })[];
  /** The highest sequence number returned (or `since` if none). */
  seq: number;
  more: boolean;
}

/** GET/PUT /api/vault */
export interface Vault {
  envelope: string;
}

/** The body of every error response. */
export interface ApiError {
  error: string;
}

// ------------------------------------------------------------------ Open Banking (P5)

/** A bank the aggregator can connect to. */
export interface Institution {
  id: string;
  name: string;
  logo: string | null;
}

/** A bank connection: its consent state and when the consent expires. */
export interface BankLink {
  id: string;
  institutionName: string;
  status: 'pending' | 'linked' | 'expired' | 'failed';
  expiresAt: string;
}

/** An account at a connected bank. */
export interface BankAccount {
  id: string;
  name: string;
  /** Last digits only, e.g. "••6789". */
  mask: string | null;
  currency: string;
  /** In minor units, as the bank reports it. */
  balance: number | null;
}

/** A transaction from a connected bank, before it is prepared like an imported row. */
export interface BankTransaction {
  /** The bank's id, used to skip transactions already imported. */
  id: string;
  date: string;
  /** Minor units; negative is money out. */
  amount: number;
  description: string;
  currency: string;
}

// ------------------------------------------------------------------ Households (P11)

/** A household the user belongs to, with its members (their emails) and who created it. */
export interface Space {
  id: string;
  /** True when you created it. */
  owner: boolean;
  members: { email: string; you: boolean; owner: boolean }[];
}
