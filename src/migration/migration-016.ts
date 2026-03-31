import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config: sql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 1433,
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
};

export const run = async () => {
  let pool: sql.ConnectionPool | null = null;

  try {
    console.log('🔌  migration-016: connecting …');
    pool = await sql.connect(config);
    console.log('✅  migration-016: connected');

    // ── Fix existing broken avatar paths ───────────────────────────
    await pool.request().query(`
      UPDATE users
      SET avatar = '/uploads/avatars/' +
        REPLACE(REPLACE(name, ' ', '_'), '-', '_') + '_avatar.jpg'
      WHERE avatar LIKE '/images/%'
    `);
    console.log('✅  migration-016: fixed avatar paths');

    // ── connections table ───────────────────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'connections')
      BEGIN
        CREATE TABLE connections (
          id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          sender_id   UNIQUEIDENTIFIER NOT NULL,
          receiver_id UNIQUEIDENTIFIER NOT NULL,
          status      NVARCHAR(20)     NOT NULL DEFAULT 'pending'
                        CONSTRAINT CHK_conn_status
                        CHECK (status IN ('pending','accepted','rejected','blocked')),
          created_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          updated_at  DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_connections PRIMARY KEY (id),
          CONSTRAINT FK_conn_sender   FOREIGN KEY (sender_id)   REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT FK_conn_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT UQ_connection    UNIQUE (sender_id, receiver_id),
          CONSTRAINT CHK_no_self_connect CHECK (sender_id <> receiver_id)
        );
      END
    `);
    console.log('✅  migration-016: connections table ready');

    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_conn_receiver' AND object_id = OBJECT_ID('connections'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_conn_receiver ON connections(receiver_id, status) INCLUDE (sender_id, created_at) WITH (FILLFACTOR = 90);
      END
    `);

    // ── messages table ──────────────────────────────────────────────
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'messages')
      BEGIN
        CREATE TABLE messages (
          id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          sender_id    UNIQUEIDENTIFIER NOT NULL,
          recipient_id UNIQUEIDENTIFIER NOT NULL,
          post_id      UNIQUEIDENTIFIER NULL,
          type         NVARCHAR(50)     NOT NULL DEFAULT 'message',
          content      NVARCHAR(MAX)    NULL,
          created_at   DATETIME2        NOT NULL DEFAULT SYSDATETIME(),
          CONSTRAINT PK_messages    PRIMARY KEY (id),
          CONSTRAINT FK_msg_sender    FOREIGN KEY (sender_id)    REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT FK_msg_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE NO ACTION,
          CONSTRAINT FK_msg_post      FOREIGN KEY (post_id)      REFERENCES Posts(id) ON DELETE SET NULL
        );
      END
    `);
    console.log('✅  migration-016: messages table ready');

    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_msg_recipient' AND object_id = OBJECT_ID('messages'))
      BEGIN
        CREATE NONCLUSTERED INDEX IX_msg_recipient ON messages(recipient_id, created_at DESC) INCLUDE (sender_id, type, post_id) WITH (FILLFACTOR = 85);
      END
    `);

    console.log('\n🎉  migration-016 complete!\n');
  } finally {
    if (pool) {
      await pool.close();
      console.log('🔒 Database connection closed');
    }
  }
};