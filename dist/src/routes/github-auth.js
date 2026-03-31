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
import { getPool } from './microsoft-auth.js';
dotenv.config();
const router = express.Router();
router.use(cookieParser());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.omahconnect.com/';
// =========================
// CSRF State Store
// =========================
const stateStore = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [state, ts] of stateStore.entries()) {
        if (now - ts > 600000)
            stateStore.delete(state);
    }
}, 600000);
// =========================
// Helpers
// =========================
const redirectError = (res, reason) => res.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(reason)}`);
const exchangeCodeForToken = async (code) => {
    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: process.env.GITHUB_REDIRECT_URI,
        }),
    });
    if (!res.ok)
        return null;
    const data = await res.json();
    return data.access_token ?? null;
};
const fetchGitHubUser = async (accessToken) => {
    const res = await fetch('https://api.github.com/user', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
        },
    });
    if (!res.ok)
        return null;
    return res.json();
};
const fetchGitHubEmail = async (accessToken) => {
    const res = await fetch('https://api.github.com/user/emails', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
        },
    });
    if (!res.ok)
        return null;
    const emails = await res.json();
    const primary = emails.find((e) => e.primary && e.verified);
    return primary?.email ?? emails[0]?.email ?? null;
};
const saveAvatar = async (name, avatarUrl) => {
    const imagesDir = path.join(__dirname, '..', 'uploads', 'avatars');
    if (!fs.existsSync(imagesDir))
        fs.mkdirSync(imagesDir, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
    const avatarFile = `${safeName}_github.png`;
    const avatarPath = path.join(imagesDir, avatarFile);
    const avatarPublicPath = `/uploads/avatars/${avatarFile}`;
    try {
        const url = avatarUrl
            ? `${avatarUrl}&size=200`
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=200`;
        const res = await fetch(url);
        if (res.ok)
            fs.writeFileSync(avatarPath, Buffer.from(await res.arrayBuffer()));
    }
    catch (e) {
        console.error('⚠️ Avatar save failed:', e);
    }
    return avatarPublicPath;
};
const upsertUser = async (email, name, avatar) => {
    const db = await getPool();
    const result = await db
        .request()
        .input('email', sql.NVarChar(255), email)
        .input('name', sql.NVarChar(255), name)
        .input('avatar', sql.NVarChar(500), avatar)
        .query(`
      MERGE users AS target
      USING (SELECT @email AS email) AS source
      ON target.email = source.email
      WHEN MATCHED THEN
        UPDATE SET name=@name, avatar=@avatar, updated_at=SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (id, email, name, role, avatar, created_at, updated_at)
        VALUES (NEWID(), @email, @name, 'FREELANCER', @avatar, SYSDATETIME(), SYSDATETIME());
      SELECT id, email, name, role, avatar FROM users WHERE email=@email;
    `);
    return result.recordset[0];
};
const signAndSetCookie = (res, user) => {
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
    });
};
// =========================
// Step 1: Redirect to GitHub
// =========================
/**
 * @swagger
 * /api/auth/github:
 *   get:
 *     tags: [Auth]
 *     summary: Initiate GitHub OAuth flow
 *     description: >
 *       Generates a cryptographically secure CSRF `state` token (16 random bytes),
 *       stores it in an in-memory map (TTL 10 minutes), then redirects the browser
 *       to GitHub's authorization page requesting the `read:user` and `user:email`
 *       scopes.
 *
 *       **Required env vars:** `GITHUB_CLIENT_ID`, `GITHUB_REDIRECT_URI`
 *     responses:
 *       302:
 *         description: Redirect to `https://github.com/login/oauth/authorize`
 *         headers:
 *           Location:
 *             description: GitHub authorization URL with `client_id`, `redirect_uri`, `scope`, and `state`
 *             schema:
 *               type: string
 *               example: "https://github.com/login/oauth/authorize?client_id=...&state=abc123"
 *       500:
 *         description: GitHub OAuth env vars not configured
 */
router.get('/github', (req, res) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_REDIRECT_URI)
        return res.status(500).send('GitHub OAuth not configured');
    const state = crypto.randomBytes(16).toString('hex');
    stateStore.set(state, Date.now());
    const params = new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        redirect_uri: process.env.GITHUB_REDIRECT_URI,
        scope: 'read:user user:email',
        state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});
// =========================
// Step 2: Callback
// =========================
/**
 * @swagger
 * /api/auth/github/callback:
 *   get:
 *     tags: [Auth]
 *     summary: GitHub OAuth callback
 *     description: >
 *       GitHub redirects the user here after they authorise (or deny) the app.
 *       This endpoint:
 *
 *       1. Validates the CSRF `state` token against the in-memory store
 *       2. Exchanges the `code` for a GitHub access token
 *       3. Fetches the GitHub user profile and primary verified email
 *       4. Downloads and saves the avatar locally under `/uploads/avatars/`
 *       5. Upserts the user in the database (`MERGE` — insert on first login, update on return)
 *       6. Signs a 7-day JWT and sets it as the `auth_token` HTTP-only cookie
 *       7. Redirects to `FRONTEND_URL/social/feed`
 *
 *       On any failure the browser is redirected to `FRONTEND_URL/login?error=<reason>`
 *       with one of the documented error codes below.
 *
 *       > **Note:** This endpoint is called by GitHub, not directly by your frontend.
 *       > It is documented here for transparency and debugging purposes.
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: One-time authorisation code issued by GitHub
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
 *         description: Set by GitHub when the user denies the OAuth request
 *     responses:
 *       302:
 *         description: >
 *           Redirect on success → `FRONTEND_URL/social/feed` (cookie set).
 *
 *           Redirect on failure → `FRONTEND_URL/login?error=<reason>` where
 *           `reason` is one of: `access_denied` · `missing_code` · `invalid_state` ·
 *           `token_exchange_failed` · `user_fetch_failed` · `email_missing` ·
 *           `authentication_failed`
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
router.get('/github/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;
        if (error)
            return redirectError(res, error);
        if (!code)
            return redirectError(res, 'missing_code');
        if (!stateStore.has(state))
            return redirectError(res, 'invalid_state');
        stateStore.delete(state);
        const accessToken = await exchangeCodeForToken(code);
        if (!accessToken)
            return redirectError(res, 'token_exchange_failed');
        const ghUser = await fetchGitHubUser(accessToken);
        if (!ghUser)
            return redirectError(res, 'user_fetch_failed');
        const email = ghUser.email ?? await fetchGitHubEmail(accessToken);
        if (!email)
            return redirectError(res, 'email_missing');
        const name = ghUser.name || ghUser.login || 'GitHub User';
        const avatar = await saveAvatar(name, ghUser.avatar_url ?? null);
        const user = await upsertUser(email, name, avatar);
        signAndSetCookie(res, user);
        res.redirect(`${FRONTEND_URL}/social/feed`);
    }
    catch (err) {
        console.error('❌ GitHub auth error:', err);
        redirectError(res, 'authentication_failed');
    }
});
export default router;
