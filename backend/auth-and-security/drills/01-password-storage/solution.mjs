/**
 * export async function hash(password) -> string   (store this)
 * export async function verify(password, stored) -> boolean
 *
 * The version below is what a shocking amount of production code still does. Every property the
 * runner checks is one it fails.
 *
 * Node gives you everything you need with NO dependencies:
 *   crypto.randomBytes(16)
 *   crypto.scrypt(password, salt, keylen, options, cb)   // or scryptSync
 *   crypto.timingSafeEqual(a, b)
 *
 * (In production prefer argon2id; scrypt is the strongest thing in the standard library and is
 * perfectly acceptable.)
 */
import crypto from 'node:crypto';

export async function hash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function verify(password, stored) {
  return (await hash(password)) === stored;
}
