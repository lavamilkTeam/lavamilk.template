import { migrate, checkSchema } from './migrations/index.js';
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL must be explicitly set');
if (process.argv.includes('--check')) {
  await checkSchema(url);
} else { await migrate(url); }
console.log('Database schema verified');
