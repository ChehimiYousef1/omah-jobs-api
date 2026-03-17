import express from 'express';
import sql from 'mssql';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { URLSearchParams } from 'url';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { sendResetEmail } from '../utils/mail.js';

dotenv.config();
const router = express.Router();

// =========================
// ES MODULE __dirname FIX
// =========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// SQL Server config
// =========================
const sqlConfig: sql.config = {
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  server: process.env.DB_HOST!,
  database: process.env.DB_NAME!,
  port: Number(process.env.DB_PORT) || 1433,
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let pool: sql.ConnectionPool | null = null;
export const getPool = async () => {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
    pool.on('error', (err) => {
      console.error('SQL Pool Error:', err);
      pool = null;
    });
  }
  return pool;
};

// =========================
// State store for OAuth
// =========================
const stateStore = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [state, ts] of stateStore.entries()) {
    if (now - ts > 600000) stateStore.delete(state);
  }
}, 600000);

// =========================
// Middleware
// =========================
router.use(cookieParser());

// =========================
// Step 1: Redirect to Microsoft
// =========================

/**
 * @swagger
 * /api/auth/microsoft:
 *   get:
 *     tags: [Auth]
 *     summary: Initiate Microsoft OAuth flow
 *     description: >
 *       Generates a cryptographically secure CSRF `state` token (16 random bytes),
 *       stores it in an in-memory map (TTL 10 minutes), then redirects the browser
 *       to Microsoft's authorization endpoint requesting `openid profile email User.Read`
 *       scopes with `prompt=select_account` to always show the account picker.
 *
 *       **Required env vars:** `MICROSOFT_CLIENT_ID`, `MICROSOFT_REDIRECT_URI`
 *     responses:
 *       302:
 *         description: Redirect to Microsoft login page
 *         headers:
 *           Location:
 *             description: Microsoft authorization URL with all OAuth parameters
 *             schema:
 *               type: string
 *               example: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=...&state=abc123"
 *       500:
 *         description: Microsoft OAuth env vars not configured
 */
router.get('/microsoft', (req, res) => {
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_REDIRECT_URI)
    return res.status(500).send('Microsoft OAuth not configured');

  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    prompt: 'select_account',
    state,
  });

  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
});

// =========================
// Step 2: Callback
// =========================

/**
 * @swagger
 * /api/auth/microsoft/callback:
 *   get:
 *     tags: [Auth]
 *     summary: Microsoft OAuth callback
 *     description: >
 *       Microsoft redirects the user here after they authorise (or deny) the app.
 *       This endpoint:
 *
 *       1. Validates the CSRF `state` token against the in-memory store
 *       2. Exchanges the `code` for a Microsoft access token via `/oauth2/v2.0/token`
 *       3. Fetches the user profile from `https://graph.microsoft.com/v1.0/me`
 *       4. Generates an avatar via `ui-avatars.com` and saves it to `/uploads/avatars/`
 *       5. Upserts the user in the database (`MERGE` — insert on first login, update on return)
 *       6. Signs a 7-day JWT and sets it as the `auth_token` HTTP-only cookie
 *       7. Redirects to `FRONTEND_URL/social/feed`
 *
 *       On any failure the browser is redirected to `FRONTEND_URL/login?error=<reason>`.
 *
 *       > **Note:** This endpoint is called by Microsoft, not directly by your frontend.
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: One-time authorisation code issued by Microsoft
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: CSRF state token originally generated in Step 1
 *       - in: query
 *         name: error
 *         required: false
 *         schema:
 *           type: string
 *           example: access_denied
 *         description: Set by Microsoft when the user denies the OAuth request
 *     responses:
 *       302:
 *         description: >
 *           Redirect on success → `FRONTEND_URL/social/feed` (cookie set).
 *
 *           Redirect on failure → `FRONTEND_URL/login?error=<reason>` where
 *           `reason` is one of: `invalid_state` · `access_denied` · `missing_code` ·
 *           `token_exchange_failed` · `email_missing` · `authentication_failed`
 *         headers:
 *           Location:
 *             description: Destination URL after the OAuth handshake
 *             schema:
 *               type: string
 *               example: "http://localhost:5173/social/feed"
 *           Set-Cookie:
 *             description: "`auth_token` HTTP-only cookie (7-day JWT) — set on success only"
 *             schema:
 *               type: string
 *               example: "auth_token=eyJ...; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800"
 */
router.get('/microsoft/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const { code, state, error } = req.query as Record<string, string>;

    if (state && !stateStore.has(state)) {
      return res.redirect(`${frontendUrl}/login?error=invalid_state`);
    }
    if (state) stateStore.delete(state);

    if (error) return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
    if (!code) return res.redirect(`${frontendUrl}/login?error=missing_code`);

    const tokenParams = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenData: any = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
    }

    const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const msUser: any = await userRes.json();

    const email = msUser.mail || msUser.userPrincipalName;
    const name = msUser.displayName || 'Unknown User';

    if (!email) return res.redirect(`${frontendUrl}/login?error=email_missing`);

    // Handle Avatar
    // ✅ Now saves to /uploads/avatars/ — matches static serve + DB paths
    const imagesDir = path.join(__dirname, '..', 'uploads', 'avatars');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
    const avatarFile = `${safeName}_microsoft.png`;
    const avatarPath = path.join(imagesDir, avatarFile);
    const avatarPublicPath = `/uploads/avatars/${avatarFile}`;

    try {
      const avatarRes = await fetch(`https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=200`);
      if (avatarRes.ok) fs.writeFileSync(avatarPath, Buffer.from(await avatarRes.arrayBuffer()));
    } catch (e) {
      console.error("Avatar save failed", e);
    }

    const dbPool = await getPool();
    const result = await dbPool
      .request()
      .input('email', sql.NVarChar(255), email)
      .input('name', sql.NVarChar(255), name)
      .input('avatar', sql.NVarChar(500), avatarPublicPath)
      .query(`
        MERGE users AS target
        USING (SELECT @email AS email) AS source
        ON target.email = source.email
        WHEN MATCHED THEN
          UPDATE SET name=@name, avatar=@avatar, updated_at=SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (id,email,name,role,avatar,created_at,updated_at)
          VALUES (NEWID(),@email,@name,'FREELANCER',@avatar,SYSDATETIME(),SYSDATETIME());
        SELECT id,email,name,role,avatar FROM users WHERE email=@email;
      `);

    const user = result.recordset[0];

    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role }, 
      process.env.JWT_SECRET!, 
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.redirect(`${frontendUrl}/social/feed`);
  } catch (err) {
    console.error('Authentication error:', err);
    res.redirect(`${frontendUrl}/login?error=authentication_failed`);
  }
});

// =========================
// Step 3: Logout
// =========================

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out the current user
 *     description: >
 *       Clears the `auth_token` HTTP-only cookie by setting it to expired.
 *       Works for all login methods (email/password, Microsoft OAuth, GitHub OAuth).
 *       No request body needed.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully — cookie cleared
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 */
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { 
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  res.json({ success: true });
});

// =========================
// Step 4: Current user (GET /api/auth/me)
// =========================

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the currently authenticated user
 *     description: >
 *       Verifies the `auth_token` cookie (falls back to `token` cookie for
 *       backward compatibility), fetches the user record from the database,
 *       and returns the full profile.
 *
 *       Returns `401` on missing/invalid/expired token, `404` if the user
 *       record no longer exists in the DB (e.g. account deleted after login).
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Authenticated user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MeResponse'
 *             example:
 *               success: true
 *               user:
 *                 id: "a1b2c3d4-0000-0000-0000-000000000000"
 *                 email: "jane@example.com"
 *                 name: "Jane Doe"
 *                 role: "FREELANCER"
 *                 avatar: "/uploads/avatars/Jane_Doe_microsoft.png"
 *                 coverPage: null
 *       401:
 *         description: Missing, invalid, or expired token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               noToken:
 *                 summary: No cookie present
 *                 value:
 *                   success: false
 *                   error: "No token cookie"
 *               invalidToken:
 *                 summary: JWT invalid or expired
 *                 value:
 *                   success: false
 *                   error: "Invalid or expired token"
 *       404:
 *         description: User not found in database
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "User not found in DB"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/me', async (req, res) => {
  try {
    // ✅ Check both cookie names (your app uses both in different places)
    const token = req.cookies.auth_token || req.cookies.token;
    if (!token) return res.status(401).json({ success: false, error: 'No token cookie' });

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);

    const dbPool = await getPool();
    const result = await dbPool.request()
      .input('userId', sql.UniqueIdentifier, decoded.userId)
      .query(`
        SELECT 
          id, 
          email, 
          name, 
          role, 
          avatar, 
          coverPage
        FROM users 
        WHERE id = @userId
      `);

    if (!result.recordset[0]) {
      return res.status(404).json({ success: false, error: 'User not found in DB' });
    }

    return res.json({ 
      success: true, 
      user: {
        ...result.recordset[0],
        coverPage: result.recordset[0].coverPage ?? null, // ✅ null instead of undefined
      }
    });

  } catch (err: any) {
    // ✅ Separate JWT errors from DB errors so you can see what's failing
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    console.error('❌ /me error:', err.message); // ✅ logs real DB errors
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password-reset email
 *     description: >
 *       Generates a 32-byte random token valid for **15 minutes**, stores it
 *       in the database, and sends a reset email via the configured mailer.
 *
 *       **Security:** Always returns `200 { success: true }` regardless of
 *       whether the email is registered — prevents user enumeration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordBody'
 *           example:
 *             email: jane@example.com
 *     responses:
 *       200:
 *         description: Always returned — reset email sent if the address is registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *             example:
 *               success: true
 *               message: "If that email exists, a reset link was sent."
 *       400:
 *         description: Email field missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Email required"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    const dbPool = await getPool();

    // 1️⃣ Fetch the user first
    const userResult = await dbPool.request()
      .input('email', sql.NVarChar(255), email.trim().toLowerCase())
      .query(`SELECT id, name, email FROM users WHERE email = @email`);

    const user = userResult.recordset[0];

    // Always return success to avoid exposing emails
    if (!user) {
      return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
    }

    // 2️⃣ Generate token and expiration
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    // 3️⃣ Save token to DB
    await dbPool.request()
      .input('userId', sql.UniqueIdentifier, user.id)
      .input('token', sql.NVarChar(255), token)
      .input('expires', sql.DateTime2, expires)
      .query(`
        UPDATE users
        SET reset_token = @token, reset_expires = @expires
        WHERE id = @userId
      `);

    // 4️⃣ Build reset link
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    // 5️⃣ Send email
    await sendResetEmail(user.email, user.name || 'User', resetLink);

    res.json({ success: true, message: 'If that email exists, a reset link was sent.' });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false });
  }
});

// ✅ Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/avatars');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}${ext}`;
    cb(null, filename);
  }
});
const upload = multer({ storage });

// ✅ Update avatar route

/**
 * @swagger
 * /api/auth/update-avatar:
 *   post:
 *     tags: [Auth]
 *     summary: Upload and update the current user's avatar
 *     description: >
 *       Accepts a `multipart/form-data` request with an `avatar` file field.
 *       Saves the file to `/uploads/avatars/` with a timestamp filename,
 *       updates the `avatar` column for the authenticated user, and returns
 *       the updated user object.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Image file (jpg, png, webp, etc.)
 *     responses:
 *       200:
 *         description: Avatar updated — returns updated user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthUserResponse'
 *             example:
 *               success: true
 *               user:
 *                 id: "a1b2c3d4-0000-0000-0000-000000000000"
 *                 email: "jane@example.com"
 *                 name: "Jane Doe"
 *                 role: "FREELANCER"
 *                 avatar: "/uploads/avatars/1710000000000.jpg"
 *       400:
 *         description: No file uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Avatar file is required"
 *       401:
 *         description: Not authenticated or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Not authenticated"
 *       404:
 *         description: User not found or DB update affected 0 rows
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "User not found or not updated"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/update-avatar', upload.single('avatar'), async (req, res) => {
  try {
    // 1️⃣ Get token
    const token = req.cookies.auth_token;
    if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });

    // 2️⃣ Decode token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    console.log('Decoded token:', decoded);

    const userId = decoded.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Invalid token' });

    // 3️⃣ Check uploaded file
    if (!req.file) return res.status(400).json({ success: false, error: 'Avatar file is required' });
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    console.log('Avatar URL:', avatarUrl);

    // 4️⃣ Update in SQL Server
    const dbPool = await getPool();
    const result = await dbPool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .input('avatar', sql.NVarChar(500), avatarUrl)
      .query(`
        UPDATE users
        SET avatar = @avatar, updated_at = GETDATE()
        WHERE id = @userId;
        SELECT id, email, name, role, avatar FROM users WHERE id = @userId;
      `);

    console.log('Rows affected:', result.rowsAffected);

    if (!result.recordset[0]) {
      return res.status(404).json({ success: false, error: 'User not found or not updated' });
    }

    // 5️⃣ Return updated user
    res.json({ success: true, user: result.recordset[0] });

  } catch (err: any) {
    console.error('❌ Update avatar error:', err);
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


// ✅ Multer storage for covers
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/covers');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}${ext}`;
    cb(null, filename);
  }
});
const uploadCover = multer({ storage: coverStorage });

// ✅ Update cover route

/**
 * @swagger
 * /api/auth/update-cover:
 *   post:
 *     tags: [Auth]
 *     summary: Upload and update the current user's cover photo
 *     description: >
 *       Accepts a `multipart/form-data` request with a `cover` file field.
 *       Saves the file to `/uploads/covers/` with a timestamp filename,
 *       updates the `coverPage` column for the authenticated user, and returns
 *       the updated user object.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [cover]
 *             properties:
 *               cover:
 *                 type: string
 *                 format: binary
 *                 description: Image file (jpg, png, webp, etc.)
 *     responses:
 *       200:
 *         description: Cover photo updated — returns updated user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoverUpdateResponse'
 *             example:
 *               success: true
 *               user:
 *                 id: "a1b2c3d4-0000-0000-0000-000000000000"
 *                 email: "jane@example.com"
 *                 name: "Jane Doe"
 *                 role: "FREELANCER"
 *                 avatar: "/uploads/avatars/Jane_Doe_microsoft.png"
 *                 coverPage: "/uploads/covers/1710000000000.jpg"
 *       400:
 *         description: No file uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Cover file is required"
 *       401:
 *         description: Not authenticated or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Not authenticated"
 *       404:
 *         description: User not found or DB update affected 0 rows
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "User not found or not updated"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/update-cover', uploadCover.single('cover'), async (req, res) => {
  try {
    // 1️⃣ Get token
    const token = req.cookies.auth_token;
    if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });

    // 2️⃣ Decode token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    console.log('Decoded token:', decoded);

    const userId = decoded.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Invalid token' });

    // 3️⃣ Check uploaded file
    if (!req.file) return res.status(400).json({ success: false, error: 'Cover file is required' });
    const coverUrl = `/uploads/covers/${req.file.filename}`;
    console.log('Cover URL:', coverUrl);

    // 4️⃣ Update in SQL Server
    const dbPool = await getPool();
    const result = await dbPool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .input('coverPage', sql.NVarChar(500), coverUrl)
      .query(`
        UPDATE users
        SET coverPage = @coverPage, updated_at = GETDATE()
        WHERE id = @userId;
        SELECT id, email, name, role, avatar, coverPage FROM users WHERE id = @userId;
      `);

    console.log('Rows affected:', result.rowsAffected);

    if (!result.recordset[0]) {
      return res.status(404).json({ success: false, error: 'User not found or not updated' });
    }

    // 5️⃣ Return updated user
    return res.json({ success: true, user: result.recordset[0] });

  } catch (err: any) {
    console.error('❌ Update cover error:', err);
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// =========================
// DELETE POST
// =========================

/**
 * @swagger
 * /api/auth/posts/{id}:
 *   delete:
 *     tags: [Posts]
 *     summary: Delete a post (owner only)
 *     description: >
 *       Permanently deletes a post. The authenticated user must be the
 *       original author — ownership is verified by comparing `userId` in
 *       the JWT against the `userId` column in the posts table.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to delete
 *     responses:
 *       200:
 *         description: Post deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *             example:
 *               success: true
 *               message: "Post deleted successfully"
 *       401:
 *         description: Not authenticated or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Not authenticated"
 *       403:
 *         description: Authenticated user is not the post owner
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Unauthorized"
 *       404:
 *         description: Post not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Post not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/posts/:id', async (req, res) => {
  try {
    const token = req.cookies.auth_token;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Decode JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const userId = decoded.userId;

    const postId = req.params.id;

    const dbPool = await getPool();

    // 1️⃣ Check if post exists + get owner
    const postResult = await dbPool.request()
      .input('postId', sql.UniqueIdentifier, postId)
      .query(`
        SELECT id, userId 
        FROM posts 
        WHERE id = @postId
      `);

    if (!postResult.recordset[0]) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const post = postResult.recordset[0];

    // 2️⃣ Check ownership
    if (post.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // 3️⃣ Delete post
    await dbPool.request()
      .input('postId', sql.UniqueIdentifier, postId)
      .query(`
        DELETE FROM posts 
        WHERE id = @postId
      `);

    return res.json({ success: true, message: 'Post deleted successfully' });

  } catch (err: any) {
    console.error('❌ Delete post error:', err);

    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// =========================
// UPDATE POST
// =========================

/**
 * @swagger
 * /api/auth/posts/{id}:
 *   put:
 *     tags: [Posts]
 *     summary: Update a post (owner only)
 *     description: >
 *       Updates post fields and optionally replaces the attachment file.
 *       Accepts `multipart/form-data` so a new file can be uploaded alongside
 *       the text fields. Only the original author can update their post.
 *       If no new file is uploaded the existing `attachment` is preserved.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the post to update
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePostBody'
 *           example:
 *             title: "Updated title"
 *             description: "Updated description"
 *             visibility: "public"
 *             postType: "article"
 *     responses:
 *       200:
 *         description: Post updated — returns the full updated post record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 post:
 *                   $ref: '#/components/schemas/Post'
 *       401:
 *         description: Not authenticated or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Not authenticated"
 *       403:
 *         description: Authenticated user is not the post owner
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Unauthorized"
 *       404:
 *         description: Post not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Post not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put('/posts/:id', upload.single('file'), async (req, res) => {
  try {
    const token = req.cookies.auth_token;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // ✅ Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const userId = decoded.userId;

    const postId = req.params.id;

    const dbPool = await getPool();

    // 1️⃣ Check if post exists
    const postResult = await dbPool.request()
      .input('postId', sql.UniqueIdentifier, postId)
      .query(`
        SELECT * FROM posts WHERE id = @postId
      `);

    if (!postResult.recordset[0]) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const post = postResult.recordset[0];

    // 2️⃣ Check ownership
    if (post.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // 3️⃣ Prepare updated fields
    const { title, description, visibility, postType } = req.body;

    let attachmentUrl = post.attachment || null;

    if (req.file) {
      attachmentUrl = `/uploads/${req.file.filename}`;
    }

    // 4️⃣ Update post
    const updateResult = await dbPool.request()
      .input('postId', sql.UniqueIdentifier, postId)
      .input('title', sql.NVarChar(sql.MAX), title)
      .input('description', sql.NVarChar(sql.MAX), description)
      .input('visibility', sql.NVarChar(50), visibility)
      .input('postType', sql.NVarChar(50), postType)
      .input('attachment', sql.NVarChar(500), attachmentUrl)
      .query(`
        UPDATE posts
        SET title = @title,
            description = @description,
            visibility = @visibility,
            postType = @postType,
            attachment = @attachment,
            updated_at = GETDATE()
        WHERE id = @postId;

        SELECT * FROM posts WHERE id = @postId;
      `);

    return res.json({
      success: true,
      post: updateResult.recordset[0]
    });

  } catch (err: any) {
    console.error('❌ Update post error:', err);

    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;