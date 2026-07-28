import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for tenant database connection strings.
 *
 * WHY THIS EXISTS
 * ───────────────
 * In a database-per-tenant topology the catalog DB stores, for every tenant,
 * the connection string to that tenant's dedicated Postgres database. That
 * string contains the password to a database full of a customer's private
 * business data. It MUST NOT be stored in plaintext: a read-only leak of the
 * catalog table (backup, log, SQL injection, screenshot) would otherwise hand
 * an attacker every tenant's database.
 *
 * We use AES-256-GCM (authenticated encryption). GCM gives us confidentiality
 * AND integrity — a tampered ciphertext fails to decrypt rather than silently
 * returning garbage that we'd then try to connect with.
 *
 * KEY ROTATION
 * ────────────
 * The secret is a *key ring*: a map of keyId → 32-byte key, plus one
 * `primaryKeyId`. New values are encrypted under the primary key; old values
 * can still be decrypted as long as their key remains in the ring. To rotate:
 * add a new key, set it primary, re-encrypt at leisure, then drop the old key.
 *
 * SERIALIZED FORMAT (string, safe for a Postgres text column)
 *   v1:<keyId>:<base64url(iv)>:<base64url(authTag)>:<base64url(ciphertext)>
 *
 * `iv` is a fresh 12-byte nonce per encryption (NIST-recommended size for GCM).
 * Never reuse an (key, iv) pair — randomBytes(12) makes collision negligible.
 */

const SCHEME = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32; // AES-256

export interface KeyRing {
  primaryKeyId: string;
  keys: Record<string, Buffer>; // keyId -> 32-byte key
}

export class ConnectionSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionSecretError';
  }
}

/**
 * Build a KeyRing from an env value. Format (one or more, comma-separated):
 *   <keyId>:<base64 32-byte key>
 * The FIRST entry is the primary (used for new encryptions).
 *
 * Example env:
 *   TENANT_SECRET_KEYS="k1:Jx9...==,k0:Ab12...=="
 *
 * Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
export function keyRingFromEnv(raw: string | undefined): KeyRing {
  if (!raw || !raw.trim()) {
    throw new ConnectionSecretError(
      'TENANT_SECRET_KEYS is not set. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  const keys: Record<string, Buffer> = {};
  let primaryKeyId: string | undefined;

  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) {
      throw new ConnectionSecretError(`Malformed key entry (want "keyId:base64"): "${trimmed}"`);
    }
    const keyId = trimmed.slice(0, idx);
    const b64 = trimmed.slice(idx + 1);
    const key = Buffer.from(b64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new ConnectionSecretError(
        `Key "${keyId}" must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
          'Keys must be 32 random bytes, base64-encoded.',
      );
    }
    keys[keyId] = key;
    if (!primaryKeyId) primaryKeyId = keyId;
  }

  if (!primaryKeyId) throw new ConnectionSecretError('No valid keys found in TENANT_SECRET_KEYS.');
  return { primaryKeyId, keys };
}

/** Encrypt a plaintext connection string under the ring's primary key. */
export function encryptSecret(plaintext: string, ring: KeyRing): string {
  const key = ring.keys[ring.primaryKeyId];
  if (!key) throw new ConnectionSecretError(`Primary key "${ring.primaryKeyId}" missing from ring.`);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    SCHEME,
    ring.primaryKeyId,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** Decrypt a value produced by {@link encryptSecret}. Throws if tampered or key unknown. */
export function decryptSecret(serialized: string, ring: KeyRing): string {
  const parts = serialized.split(':');
  if (parts.length !== 5 || parts[0] !== SCHEME) {
    throw new ConnectionSecretError('Unrecognized secret format.');
  }
  const [, keyId, ivB64, tagB64, ctB64] = parts;
  // Narrow each part to `string` (noUncheckedIndexedAccess types them as
  // `string | undefined`). The length check above already guarantees presence.
  if (!keyId || !ivB64 || !tagB64 || !ctB64) {
    throw new ConnectionSecretError('Unrecognized secret format.');
  }
  const key = ring.keys[keyId];
  if (!key) {
    throw new ConnectionSecretError(
      `Secret was encrypted with key "${keyId}", which is not in the current ring. ` +
        'Did you drop a key that is still in use?',
    );
  }

  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ctB64, 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // GCM auth failure => ciphertext or tag was tampered with, or wrong key.
    throw new ConnectionSecretError('Secret failed authentication (tampered or wrong key).');
  }
}

/** True if `serialized` decrypts under `keyId` other than the primary — i.e. needs re-encrypt. */
export function needsReencrypt(serialized: string, ring: KeyRing): boolean {
  const keyId = serialized.split(':')[1];
  return keyId !== ring.primaryKeyId;
}
