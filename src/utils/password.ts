import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-only', BCRYPT_COST);