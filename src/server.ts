// ─── MUST be first ────────────────────────────────────────────────────────────
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ✅ server.ts is at server/src/server.ts → ../ = server/ → .env is at server/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── All other imports ────────────────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import sql from 'mssql';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import swaggerDefinition from '../utils/swaggerOption.js';

import authRoutes             from '../routes/microsoft-auth.js';
import githubAuthRoutes       from '../routes/github-auth.js';
import postInteractions       from '../routes/postInteractions.routes.js';
import postsRoutes            from '../routes/posts.routes.js';
import connectionsRoutes      from '../routes/connections.routes.js';
import messagesRoutes         from '../routes/messages.routes.js';
import commentsRoutes         from '../routes/comments.routes.js';
import forgotPasswordRoutes   from '../routes/forget-pass.routes.js';
import authRoutesRegistration from '../routes/auth.routes.js';

const app  = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/images',  express.static(path.join(__dirname, '..', 'images')));

// ─── Swagger ──────────────────────────────────────────────────────────────────
const swaggerOptions: swaggerJSDoc.Options = {
  swaggerDefinition,
  apis: [
    path.join(__dirname, 'server.ts'),
    path.join(__dirname, '../routes/*.ts'),
    path.join(__dirname, '../routes/*.js'),
  ],
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'OMAH Jobs — API Docs',
  swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true, filter: true },
}));

app.get('/api/docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ─── Root route ───────────────────────────────────────────────────────────────
// ✅ Fixes 404 on / for Render deployment
app.get('/', (_req, res) => {
  res.redirect('/api/docs');
});

// ─── Database ─────────────────────────────────────────────────────────────────
const dbConfig: sql.config = {
  user:     process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  server:   process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  port:     Number(process.env.DB_PORT) || 1433,
  options:  { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  pool:     { max: 10, min: 0, idleTimeoutMillis: 30_000 },
};

let pool: sql.ConnectionPool | null = null;
export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!pool || !pool.connected) pool = await sql.connect(dbConfig);
  return pool;
};

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',                   authRoutes);
app.use('/api/auth',                   githubAuthRoutes);
app.use('/api/auth',                   forgotPasswordRoutes);
app.use('/api/auth',                   authRoutesRegistration);
app.use('/api/posts',                  postsRoutes);
app.use('/api/post-interactions',      postInteractions);
app.use('/api/posts/:postId/comments', commentsRoutes);
app.use('/api/connections',            connectionsRoutes);
app.use('/api/messages',               messagesRoutes);

// ─── Start Server ─────────────────────────────────────────────────────────────
getPool()
  .then(() => {
    console.log('✅ DB connected');
    app.listen(PORT, () => {
      console.log(`🚀 Server    → http://localhost:${PORT}`);
      console.log(`📖 API Docs  → http://localhost:${PORT}/api/docs`);
      console.log(`📄 JSON Spec → http://localhost:${PORT}/api/docs.json`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to connect to DB:', err);
    process.exit(1);
  });