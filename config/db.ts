import sql from 'mssql';

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

// Make sure this is exported!
export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!pool) {
    try {
      pool = await sql.connect(config);
      console.log('✅ Database connected successfully');

      pool.on('error', (err) => {
        console.error('❌ Database pool error:', err);
        pool = null;
      });
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      throw error;
    }
  }
  return pool;
};

export const closePool = async (): Promise<void> => {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('🔒 Database connection closed');
  }
};
