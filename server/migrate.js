import mysql from 'mysql2/promise';
import { migrate, verifySchema } from './migrations/index.js';
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL must be explicitly set');
if (process.argv.includes('--check')) {
  const db = await mysql.createConnection(url);
  try { await verifySchema(db); } finally { await db.end(); }
} else { await migrate(url); }
console.log('Database schema verified');
