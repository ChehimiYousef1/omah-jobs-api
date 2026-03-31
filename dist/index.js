import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sql from 'mssql';
import path from 'path';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { URLSearchParams } from 'url';
import fetch from 'node-fetch';
import multer from "multer";
import jwt from 'jsonwebtoken';
import fs from 'fs';
/* =========================
   FIX __dirname FOR ES MODULES
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/* =========================
   LOAD DOTENV EARLY
========================= */
dotenv.config({ path: path.resolve(__dirname, '.env') });
console.log('MICROSOFT_CLIENT_ID:', process.env.MICROSOFT_CLIENT_ID);
console.log('MICROSOFT_REDIRECT_URI:', process.env.MICROSOFT_REDIRECT_URI);
const app = express();
const PORT = Number(process.env.APP_PORT) || 3001;
// =========================
// MIDDLEWARE
// =========================
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/images', express.static(path.join(__dirname, '..', 'images')));
// =========================
// DATABASE CONFIG
// =========================
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 1433,
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};
// Database pool
let pool = null;
const getPool = async () => {
    if (!pool) {
        pool = await sql.connect(dbConfig);
        pool.on('error', (err) => {
            console.error('Database pool error:', err);
            pool = null;
        });
    }
    return pool;
};
// =========================
// HEALTH CHECK
// =========================
app.get('/api/health', (_req, res) => {
    res.json({ status: 'OK', message: 'API running', timestamp: new Date().toISOString() });
});
// STEP 1: REDIRECT TO MICROSOFT
app.get('/api/auth/microsoft', (req, res) => {
    if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_REDIRECT_URI) {
        return res.status(500).send('Microsoft OAuth not configured');
    }
    const state = crypto.randomBytes(16).toString('hex');
    // Save state in cookie
    res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax' });
    const params = new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        response_type: 'code',
        redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
        response_mode: 'query',
        scope: 'openid profile email User.Read',
        prompt: 'select_account',
        state,
    });
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    res.redirect(authUrl);
});
// STEP 2: CALLBACK
app.get('/api/auth/microsoft/callback', async (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
        const code = req.query.code;
        const error = req.query.error;
        if (error)
            return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
        if (!code)
            return res.redirect(`${frontendUrl}/login?error=missing_code`);
        const bodyParams = {
            client_id: process.env.MICROSOFT_CLIENT_ID,
            code,
            redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
            grant_type: 'authorization_code',
        };
        if (process.env.MICROSOFT_CLIENT_SECRET)
            bodyParams.client_secret = process.env.MICROSOFT_CLIENT_SECRET;
        const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(bodyParams),
        });
        if (!tokenRes.ok) {
            const text = await tokenRes.text();
            return res.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
        }
        const tokenData = (await tokenRes.json());
        if (!tokenData.access_token)
            return res.redirect(`${frontendUrl}/login?error=no_access_token`);
        const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (!userRes.ok)
            return res.redirect(`${frontendUrl}/login?error=profile_fetch_failed`);
        const msUser = (await userRes.json());
        const email = msUser.mail || msUser.userPrincipalName;
        const name = msUser.displayName || 'Unknown User';
        if (!email)
            return res.redirect(`${frontendUrl}/login?error=email_missing`);
        // Avatar
        const imagesDir = path.join(__dirname, '..', 'images');
        if (!fs.existsSync(imagesDir))
            fs.mkdirSync(imagesDir, { recursive: true });
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
        const avatarFile = `${safeName}.png`;
        const avatarPath = path.join(imagesDir, avatarFile);
        const avatarPublicPath = `/images/${avatarFile}`;
        try {
            const avatarRes = await fetch(`https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=200&background=random`);
            if (avatarRes.ok) {
                const buffer = Buffer.from(await avatarRes.arrayBuffer());
                fs.writeFileSync(avatarPath, buffer);
            }
        }
        catch { }
        // Save to DB
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
          UPDATE SET name = @name, avatar = @avatar, updated_at = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (id, email, name, role, avatar, created_at, updated_at)
          VALUES (NEWID(), @email, @name, 'FREELANCER', @avatar, SYSDATETIME(), SYSDATETIME());
        SELECT id, email, name, role, avatar FROM users WHERE email = @email;
      `);
        const user = result.recordset[0];
        if (!process.env.JWT_SECRET)
            return res.redirect(`${frontendUrl}/login?error=server_configuration_error`);
        const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
            expiresIn: '7d',
        });
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        res.redirect(`${frontendUrl}/social/feed`);
    }
    catch (err) {
        console.error('❌ Authentication error:', err);
        res.redirect(`${frontendUrl}/login?error=authentication_failed`);
    }
});
// =========================
// LOGOUT
// =========================
app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logged out successfully' });
});
// =========================
// CURRENT USER
// =========================
app.get('/api/auth/me', async (req, res) => {
    try {
        const token = req.cookies.auth_token;
        if (!token)
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const dbPool = await getPool();
        const result = await dbPool
            .request()
            .input('userId', sql.UniqueIdentifier, decoded.userId)
            .query('SELECT id, email, name, role, avatar FROM users WHERE id = @userId');
        if (result.recordset.length === 0)
            return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, user: result.recordset[0] });
    }
    catch (err) {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
});
// =========================
// START SERVER
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, "uploads");
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});
const uploads = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only images allowed"));
        }
        cb(null, true);
    }
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.post("/api/posts", uploads.array("images", 10), async (req, res) => {
    try {
        const token = req.cookies.auth_token;
        if (!token)
            return res.status(401).json({ error: "Not authenticated" });
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        }
        catch {
            return res.status(401).json({ error: "Invalid token" });
        }
        const userId = decoded.userId;
        const { title, description } = req.body;
        const files = (req.files || []);
        if (!description && files.length === 0) {
            return res.status(400).json({ error: "Post cannot be empty" });
        }
        if (files.length > 0 && (!title || title.trim() === "")) {
            return res.status(400).json({ error: "Title is required when posting images" });
        }
        const cleanTitle = title?.trim() || "";
        const cleanDescription = description?.trim() || "";
        const attachments = files.length
            ? JSON.stringify(files.map(file => ({ type: "image", url: `/uploads/${file.filename}` })))
            : "[]";
        const dbPool = await getPool();
        try {
            await dbPool.request()
                .input("userId", sql.UniqueIdentifier, userId)
                .input("title", sql.NVarChar, cleanTitle)
                .input("description", sql.NVarChar, cleanDescription)
                .input("attachments", sql.NVarChar, attachments)
                .query(`
          INSERT INTO Posts (userId, title, description, attachments)
          VALUES (@userId, @title, @description, @attachments)
        `);
        }
        catch (dbErr) {
            console.error("Database error:", dbErr);
            return res.status(500).json({ error: "Database error" });
        }
        res.json({ success: true, post: { userId, title: cleanTitle, description: cleanDescription, attachments: JSON.parse(attachments) } });
    }
    catch (err) {
        console.error("Server error:", err);
        res.status(500).json({ error: "Server error" });
    }
});
// Get all posts
app.get("/api/posts", async (req, res) => {
    try {
        const dbPool = await getPool();
        const result = await dbPool
            .request()
            .query(`
        SELECT p.id, p.userId, p.title, p.description, p.attachments, u.name as userName, u.avatar as userAvatar
        FROM Posts p
        LEFT JOIN users u ON u.id = p.userId
        ORDER BY p.created_at DESC
      `);
        res.json({ success: true, posts: result.recordset });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});
//=================
app.listen(PORT, () => {
    console.log(`✅ Backend running at http://localhost:${PORT}`);
});
