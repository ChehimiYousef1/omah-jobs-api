import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Fix for ES Modules ───────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── Database configuration ───────────────────────────
const config: sql.config = {
  user: process.env.DB_USER || 'omah_jobs',
  password: process.env.DB_PASSWORD || 'Youssef2002@!!',
  server: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'omah_jobs',
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export const poolPromise: Promise<sql.ConnectionPool> = (async () => {
  if (!pool) {
    pool = await sql.connect(config);

    pool.on('error', (err) => {
      console.error('❌ Database pool error:', err);
      pool = null;
    });

    console.log('✅ Database connected successfully');
  }
  return pool;
})();

export const getPool = async (): Promise<sql.ConnectionPool> => poolPromise;

export { sql };

export const closePool = async (): Promise<void> => {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('🔒 Database connection closed');
  }
};