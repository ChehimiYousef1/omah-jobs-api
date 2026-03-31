// ─── Bootstrap (must be first) ────────────────────────────────────────────────
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
// ─── Migration imports (CJS modules that export async functions) ──────────────
const runMigration = async () => {
    const mod = await import('./migration/runmigration.js'); // note: .js for tsx compilation
    await mod.default?.();
};
const migration016 = async () => {
    const mod = await import('./migration/migration-016.js'); // note: .js
    await mod.default?.();
};
// ─── Imports ──────────────────────────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import sql from 'mssql';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
// Local imports: add .js for compiled ES modules
import swaggerOptions from './utils/swaggerOption.js';
import authRoutes from './routes/microsoft-auth.js';
import githubAuthRoutes from './routes/github-auth.js';
import postInteractions from './routes/postInteractions.routes.js';
import postsRoutes from './routes/posts.routes.js';
import connectionsRoutes from './routes/connections.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import commentsRoutes from './routes/comments.routes.js';
import forgotPasswordRoutes from './routes/forget-pass.routes.js';
import authRoutesRegistration from './routes/auth.routes.js';
// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
// ─── Allowed CORS origins ─────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://omahconnect.com',
    'https://www.omahconnect.com',
    ...(process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : []),
];
// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();
// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(cors({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin))
            return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
// ─── Static Files ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/images', express.static(path.join(__dirname, '..', 'images')));
// ─── Swagger ──────────────────────────────────────────────────────────────────
const swaggerSpec = swaggerJSDoc({
    swaggerDefinition: swaggerOptions,
    apis: [path.join(__dirname, '../routes/*.js')],
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'OMAH Jobs — API Docs',
    swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true, filter: true },
}));
app.get('/api/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
    try {
        const p = await getPool();
        await p.request().query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', env: NODE_ENV });
    }
    catch {
        res.status(503).json({ status: 'error', db: 'disconnected' });
    }
});
// ─── Root → Docs redirect ─────────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/api/docs'));
// ─── Database ─────────────────────────────────────────────────────────────────
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 1433,
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
};
let pool = null;
export const getPool = async () => {
    if (pool && pool.connected)
        return pool;
    pool = await new sql.ConnectionPool(dbConfig).connect();
    pool.on('error', (err) => {
        console.error('❌ DB pool error:', err);
        pool = null;
    });
    return pool;
};
// ─── Cookie helper ────────────────────────────────────────────────────────────
export const cookieOptions = () => ({
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
});
// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/auth', githubAuthRoutes);
app.use('/api/auth', forgotPasswordRoutes);
app.use('/api/auth', authRoutesRegistration);
app.use('/api/posts', postsRoutes);
app.use('/api/post-interactions', postInteractions);
app.use('/api/posts/:postId/comments', commentsRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/messages', messagesRoutes);
// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found.' });
});
// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: IS_PROD ? 'Internal server error.' : err.message,
        ...(IS_PROD ? {} : { stack: err.stack }),
    });
});
// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal) => {
    console.log(`\n⚠️  ${signal} received — shutting down gracefully…`);
    if (pool) {
        await pool.close();
        console.log('🔌 DB pool closed.');
    }
    process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('❌ Unhandled rejection:', reason));
process.on('uncaughtException', (err) => { console.error('❌ Uncaught exception:', err); process.exit(1); });
// ─── Bootstrap ────────────────────────────────────────────────────────────────
const bootstrap = async () => {
    try {
        await runMigration();
        await migration016();
        console.log('✅ Migrations complete');
        await getPool();
        console.log('✅ DB connected');
        app.listen(PORT, () => {
            console.log(`\n🚀 Server   → http://localhost:${PORT}`);
            console.log(`📖 API Docs → http://localhost:${PORT}/api/docs`);
            console.log(`❤️  Health   → http://localhost:${PORT}/health`);
            console.log(`🌍 Env      → ${NODE_ENV}`);
            console.log(`🔐 CORS     → ${ALLOWED_ORIGINS.join(', ')}\n`);
        });
    }
    catch (err) {
        console.error('❌ Bootstrap failed:', err);
        process.exit(1);
    }
};
bootstrap();
