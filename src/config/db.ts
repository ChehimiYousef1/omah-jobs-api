import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Database configuration
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

// Connection pool variable
let pool: sql.ConnectionPool | null = null;

// Exported poolPromise for controllers
export const poolPromise: Promise<sql.ConnectionPool> = (async () => {
  if (!pool) {
    pool = await sql.connect(config);

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('❌ Database pool error:', err);
      pool = null;
    });

    console.log('✅ Database connected successfully');
  }
  return pool;
})();

export const getPool = async (): Promise<sql.ConnectionPool> => {
  return poolPromise;
};

// Export sql for type-safe queries
export { sql };

// Optional: close pool manually
export const closePool = async (): Promise<void> => {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('🔒 Database connection closed');
  }
};