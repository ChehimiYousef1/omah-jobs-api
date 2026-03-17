// ─── MUST be first: resolve __dirname before dotenv ──────────────────────────
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


// server.ts lives at server/src/server.ts → ../../.env = server/.env
// This works regardless of which directory `npm run` is executed from.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
console.log('🔍 ENV path:', path.resolve(__dirname, '../.env'));
console.log('🔍 DB_HOST:', process.env.DB_HOST);

// ─── All other imports (after .env is loaded) ─────────────────────────────────
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import sql from 'mssql';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

// ✅ swaggerDefinition must be imported at the top, before it is used
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

// ─── Swagger / OpenAPI Setup ──────────────────────────────────────────────────
const swaggerOptions: swaggerJSDoc.Options = {
  swaggerDefinition,
  apis: [
    path.join(__dirname, 'server.ts'),
    path.join(__dirname, '../routes/*.ts'),
    path.join(__dirname, '../routes/*.js'),
  ],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Interactive Swagger UI
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'My App — API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      tryItOutEnabled:       true,
      filter:                true,
    },
  }),
);

// Raw JSON spec — importable into Postman / Insomnia
app.get('/api/docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
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

// ─── Routes with Swagger JSDoc ────────────────────────────────────────────────

/**
 * @swagger
 * /api/test:
 *   post:
 *     tags: [Health]
 *     summary: Smoke-test endpoint
 *     description: >
 *       Returns `{ success: true }` — confirms the server is up.
 *     responses:
 *       200:
 *         description: Server is alive
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
app.post('/api/test', (_req, res) => {
  console.log('✅ Test endpoint hit');
  res.json({ success: true });
});

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterBody'
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email & password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginBody'
 *     responses:
 *       200:
 *         description: Login successful — sets `token` cookie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 *
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out (clears session cookie)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password-reset e-mail
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Reset e-mail sent
 *
 * /api/auth/microsoft:
 *   get:
 *     tags: [Auth]
 *     summary: Initiate Microsoft OAuth flow
 *     responses:
 *       302:
 *         description: Redirect to Microsoft login
 *
 * /api/auth/github:
 *   get:
 *     tags: [Auth]
 *     summary: Initiate GitHub OAuth flow
 *     responses:
 *       302:
 *         description: Redirect to GitHub login
 */
app.use('/api/auth', authRoutes);
app.use('/api/auth', githubAuthRoutes);
app.use('/api/auth', forgotPasswordRoutes);
app.use('/api/auth', authRoutesRegistration);

/**
 * @swagger
 * /api/posts:
 *   get:
 *     tags: [Posts]
 *     summary: Get all posts (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Array of posts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Post'
 *   post:
 *     tags: [Posts]
 *     summary: Create a new post
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePostBody'
 *     responses:
 *       201:
 *         description: Post created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Post'
 *
 * /api/posts/{postId}:
 *   get:
 *     tags: [Posts]
 *     summary: Get a single post by ID
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Post found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Post'
 *       404:
 *         description: Post not found
 *   put:
 *     tags: [Posts]
 *     summary: Update a post
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePostBody'
 *     responses:
 *       200:
 *         description: Post updated
 *   delete:
 *     tags: [Posts]
 *     summary: Delete a post
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Post deleted
 */
app.use('/api/posts', postsRoutes);

/**
 * @swagger
 * /api/post-interactions/{postId}/like:
 *   post:
 *     tags: [Interactions]
 *     summary: Like or unlike a post
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Interaction toggled
 *
 * /api/post-interactions/{postId}/bookmark:
 *   post:
 *     tags: [Interactions]
 *     summary: Bookmark or un-bookmark a post
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Bookmark toggled
 */
app.use('/api/post-interactions', postInteractions);

/**
 * @swagger
 * /api/posts/{postId}/comments:
 *   get:
 *     tags: [Comments]
 *     summary: Get comments for a post
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Array of comments
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Comment'
 *   post:
 *     tags: [Comments]
 *     summary: Add a comment to a post
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string, example: 'Great post!' }
 *     responses:
 *       201:
 *         description: Comment created
 */
app.use('/api/posts/:postId/comments', commentsRoutes);

/**
 * @swagger
 * /api/connections:
 *   get:
 *     tags: [Connections]
 *     summary: Get current user's connections
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of connection objects
 *
 * /api/connections/{userId}/follow:
 *   post:
 *     tags: [Connections]
 *     summary: Follow or unfollow a user
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Follow state toggled
 */
app.use('/api/connections', connectionsRoutes);

/**
 * @swagger
 * /api/messages:
 *   get:
 *     tags: [Messages]
 *     summary: Get conversations for the current user
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of conversations
 *
 * /api/messages/{userId}:
 *   get:
 *     tags: [Messages]
 *     summary: Get messages with a specific user
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Array of messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Message'
 *   post:
 *     tags: [Messages]
 *     summary: Send a message to a user
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string, example: 'Hey, how are you?' }
 *     responses:
 *       201:
 *         description: Message sent
 */
app.use('/api/messages', messagesRoutes);

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