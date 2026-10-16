import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import dotenv from 'dotenv';

export default function setup(): void {
  const testEnv = dotenv.parse(readFileSync('.env.test'));
  const url = testEnv.DATABASE_URL;
  if (!url) throw new Error('.env.test must define DATABASE_URL');

  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run: database "${dbName}" does not look like a test database (its name must contain "test")`);
  }

  rmSync(testEnv.UPLOAD_DIR ?? 'uploads-test', { recursive: true, force: true });

  console.log(`\nResetting test database "${dbName}" (migrations and seed)...`);
  execSync('npx prisma migrate reset --force --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, ...testEnv },
  });
}