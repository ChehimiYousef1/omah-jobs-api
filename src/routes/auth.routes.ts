import { Router, Request, Response } from 'express';
import sql from 'mssql';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { getPool } from '../routes/microsoft-auth';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
const signAndSetCookie = (res: Response, user: any) => {
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
    path:     '/',
  });
  return token;
};

// =============================================================================
// POST /api/auth/login
// =============================================================================

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email & password
 *     description: >
 *       Authenticates the user and sets an `auth_token` HTTP-only cookie valid
 *       for 7 days. A generic error message is always returned for wrong
 *       credentials to prevent email enumeration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginBody'
 *           example:
 *             email: jane@example.com
 *             password: "MySecret123"
 *     responses:
 *       200:
 *         description: Login successful — `auth_token` cookie is set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthUserResponse'
 *             example:
 *               success: true
 *               user:
 *                 id: "a1b2c3d4-..."
 *                 email: jane@example.com
 *                 name: Jane Doe
 *                 role: FREELANCER
 *                 avatar: null
 *                 coverPage: null
 *                 headline: "Full-stack developer"
 *                 bio: null
 *       400:
 *         description: Missing email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Email and password are required"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Invalid email or password"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ success: false, error: 'Email and password are required' });

    const db     = await getPool();
    const result = await db.request()
      .input('email', sql.NVarChar(255), email.trim().toLowerCase())
      .query(`
        SELECT id, email, name, role, avatar, coverPage, headline, bio, password
        FROM users
        WHERE email = @email
      `);

    const user = result.recordset[0];

    // ✅ Generic message — never reveal if email exists
    if (!user || !user.password)
      return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ success: false, error: 'Invalid email or password' });

    signAndSetCookie(res, user);

    return res.json({
      success: true,
      user: {
        id:        user.id,
        email:     user.email,
        name:      user.name,
        role:      user.role,
        avatar:    user.avatar    ?? null,
        coverPage: user.coverPage ?? null,
        headline:  user.headline  ?? null,
        bio:       user.bio       ?? null,
      },
    });

  } catch (err: unknown) {
    console.error('[login] Error:', err);
    return res.status(500).json({ success: false, error: 'An unexpected error occurred.' });
  }
});

// =============================================================================
// POST /api/auth/register/freelancer
// =============================================================================

/**
 * @swagger
 * /api/auth/register/freelancer:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new freelancer account
 *     description: >
 *       Creates a new user with the `FREELANCER` role, hashes the password with
 *       bcrypt (cost 12), and immediately sets an `auth_token` cookie so the
 *       user is logged in after registration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterFreelancerBody'
 *           example:
 *             name: Jane Doe
 *             email: jane@example.com
 *             password: "MySecret123"
 *             headline: "Full-stack developer"
 *     responses:
 *       201:
 *         description: Account created — `auth_token` cookie is set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthUserResponse'
 *             example:
 *               success: true
 *               user:
 *                 id: "a1b2c3d4-..."
 *                 email: jane@example.com
 *                 name: Jane Doe
 *                 role: FREELANCER
 *                 avatar: null
 *                 coverPage: null
 *                 headline: "Full-stack developer"
 *                 bio: null
 *       400:
 *         description: Missing required fields or password too short
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingFields:
 *                 summary: Missing fields
 *                 value:
 *                   success: false
 *                   error: "Name, email and password are required"
 *               shortPassword:
 *                 summary: Password too short
 *                 value:
 *                   success: false
 *                   error: "Password must be at least 8 characters"
 *       409:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "An account with this email already exists"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register/freelancer', async (req: Request, res: Response) => {
  try {
    const { name, email, password, headline } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, error: 'Name, email and password are required' });

    if (password.length < 8)
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

    const db = await getPool();

    // ✅ Check duplicate email
    const existing = await db.request()
      .input('email', sql.NVarChar(255), email.trim().toLowerCase())
      .query(`SELECT id FROM users WHERE email = @email`);

    if (existing.recordset.length > 0)
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 12);

    const result = await db.request()
      .input('email',    sql.NVarChar(255), email.trim().toLowerCase())
      .input('password', sql.NVarChar(255), hashed)
      .input('name',     sql.NVarChar(255), name.trim())
      .input('role',     sql.NVarChar(20),  'FREELANCER')
      .input('headline', sql.NVarChar(255), headline?.trim() ?? null)
      .query(`
        INSERT INTO users (id, email, password, name, role, headline, created_at, updated_at)
        OUTPUT INSERTED.id, INSERTED.email, INSERTED.name, INSERTED.role,
               INSERTED.avatar, INSERTED.coverPage, INSERTED.headline, INSERTED.bio
        VALUES (NEWID(), @email, @password, @name, @role, @headline, SYSDATETIME(), SYSDATETIME())
      `);

    const user = result.recordset[0];
    signAndSetCookie(res, user);

    return res.status(201).json({ success: true, user });

  } catch (err: unknown) {
    console.error('[register/freelancer] Error:', err);
    return res.status(500).json({ success: false, error: 'An unexpected error occurred.' });
  }
});

// =============================================================================
// POST /api/auth/register/company
// =============================================================================

/**
 * @swagger
 * /api/auth/register/company:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new company account
 *     description: >
 *       Creates a new user with the `COMPANY` role, hashes the password with
 *       bcrypt (cost 12), and immediately sets an `auth_token` cookie so the
 *       company is logged in after registration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterCompanyBody'
 *           example:
 *             name: Acme Corp
 *             email: hr@acme.com
 *             password: "CorpSecret123"
 *             headline: "We build great products"
 *     responses:
 *       201:
 *         description: Account created — `auth_token` cookie is set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthUserResponse'
 *             example:
 *               success: true
 *               user:
 *                 id: "b2c3d4e5-..."
 *                 email: hr@acme.com
 *                 name: Acme Corp
 *                 role: COMPANY
 *                 avatar: null
 *                 coverPage: null
 *                 headline: "We build great products"
 *                 bio: null
 *       400:
 *         description: Missing required fields or password too short
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingFields:
 *                 summary: Missing fields
 *                 value:
 *                   success: false
 *                   error: "Company name, email and password are required"
 *               shortPassword:
 *                 summary: Password too short
 *                 value:
 *                   success: false
 *                   error: "Password must be at least 8 characters"
 *       409:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "An account with this email already exists"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register/company', async (req: Request, res: Response) => {
  try {
    const { name, email, password, headline } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, error: 'Company name, email and password are required' });

    if (password.length < 8)
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

    const db = await getPool();

    // ✅ Check duplicate email
    const existing = await db.request()
      .input('email', sql.NVarChar(255), email.trim().toLowerCase())
      .query(`SELECT id FROM users WHERE email = @email`);

    if (existing.recordset.length > 0)
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 12);

    const result = await db.request()
      .input('email',    sql.NVarChar(255), email.trim().toLowerCase())
      .input('password', sql.NVarChar(255), hashed)
      .input('name',     sql.NVarChar(255), name.trim())
      .input('role',     sql.NVarChar(20),  'COMPANY')
      .input('headline', sql.NVarChar(255), headline?.trim() ?? null)
      .query(`
        INSERT INTO users (id, email, password, name, role, headline, created_at, updated_at)
        OUTPUT INSERTED.id, INSERTED.email, INSERTED.name, INSERTED.role,
               INSERTED.avatar, INSERTED.coverPage, INSERTED.headline, INSERTED.bio
        VALUES (NEWID(), @email, @password, @name, @role, @headline, SYSDATETIME(), SYSDATETIME())
      `);

    const user = result.recordset[0];
    signAndSetCookie(res, user);

    return res.status(201).json({ success: true, user });

  } catch (err: unknown) {
    console.error('[register/company] Error:', err);
    return res.status(500).json({ success: false, error: 'An unexpected error occurred.' });
  }
});

export default router;