import { Router } from 'express';
import sql from 'mssql';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { getPool } from './microsoft-auth.js';
const router = Router();
// ── Mailer (reuses your existing SMTP config) ─────────────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
// ── Email template ────────────────────────────────────────────────────────────
function buildResetEmail(name, resetLink) {
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:28px 32px;text-align:center;">
            <div style="font-size:36px;margin-bottom:6px;">🔐</div>
            <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-.3px;">OMAH Connect</div>
            <div style="color:#bfdbfe;font-size:13px;margin-top:4px;">Password Reset Request</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;">
            <p style="margin:0 0 12px;font-size:15px;color:#374151;">
              Hi <strong>${name}</strong>,
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
              We received a request to reset your password. Click the button below
              to choose a new one. This link expires in <strong>1 hour</strong>.
            </p>

            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center">
                  <a href="${resetLink}"
                    style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;
                    padding:14px 40px;border-radius:8px;font-weight:600;font-size:15px;
                    letter-spacing:.2px;">
                    Reset My Password →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Security notice -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#fef9c3;border:1px solid #fde68a;border-radius:10px;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">
                    ⚠️ <strong>Didn't request this?</strong> You can safely ignore this email.
                    Your password will not change unless you click the button above.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Fallback link -->
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
              If the button doesn't work, copy and paste this link into your browser:<br/>
              <a href="${resetLink}" style="color:#2563eb;word-break:break-all;">${resetLink}</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
              This link expires in 1 hour for your security.<br/>
              <a href="${appUrl}" style="color:#64748b;text-decoration:underline;">
                OMAH Connect
              </a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
// =============================================================================
// POST /api/auth/forgot-password
// =============================================================================
/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password-reset email
 *     description: >
 *       Generates a secure 32-byte random token, stores it in the database
 *       with a 1-hour expiry, and sends a branded reset email to the user.
 *
 *       **Security:** Always returns `200 { success: true }` regardless of
 *       whether the email exists — this prevents user enumeration attacks.
 *       The email is sent asynchronously (fire-and-forget) so it never
 *       blocks the HTTP response.
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
 *         description: >
 *           Always returned — even if the email is not registered.
 *           If the email exists, a reset link is sent.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *             example:
 *               success: true
 *               message: "If that email exists, a reset link was sent."
 *       400:
 *         description: Missing or invalid email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Valid email required"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "An unexpected error occurred."
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || typeof email !== 'string')
            return res.status(400).json({ success: false, error: 'Valid email required' });
        const db = await getPool();
        const result = await db.request()
            .input('email', sql.NVarChar(255), email.trim().toLowerCase())
            .query(`SELECT id, name, email FROM users WHERE email = @email`);
        // ✅ Always return success — prevents user enumeration
        if (result.recordset.length === 0)
            return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
        const user = result.recordset[0];
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hour
        // ✅ Save token to DB
        await db.request()
            .input('userId', sql.UniqueIdentifier, user.id)
            .input('token', sql.NVarChar(255), token)
            .input('expires', sql.DateTime, expires)
            .query(`
        UPDATE users
        SET reset_token   = @token,
            reset_expires = @expires
        WHERE id = @userId
      `);
        // ✅ Build reset link pointing to frontend reset page
        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
        // ✅ Send email — fire and forget, never blocks response
        transporter.sendMail({
            from: `"OMAH Connect" <${process.env.SMTP_USER}>`,
            to: user.email,
            subject: 'Reset your OMAH Connect password',
            html: buildResetEmail(user.name, resetLink),
        }).catch(err => console.error('[forgot-password] Email send failed:', err));
        return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
    }
    catch (err) {
        console.error('[forgot-password] Error:', err);
        return res.status(500).json({ success: false, error: 'An unexpected error occurred.' });
    }
});
// =============================================================================
// POST /api/auth/reset-password
// =============================================================================
/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using a valid token
 *     description: >
 *       Validates the one-time reset token (from the email link), checks it
 *       has not expired, hashes the new password with bcrypt (cost 12), saves
 *       it, and clears the token so it cannot be reused.
 *
 *       The token is delivered via the frontend URL as a query param:
 *       `/reset-password?token=<token>` — the frontend then POSTs it here
 *       together with the new password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordBody'
 *           example:
 *             token: "a3f1c29d8e..."
 *             password: "NewSecret123"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *             example:
 *               success: true
 *               message: "Password reset successfully. You can now log in."
 *       400:
 *         description: Validation error — missing fields, short password, invalid or expired token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingFields:
 *                 summary: Missing token or password
 *                 value:
 *                   success: false
 *                   error: "Token and password are required"
 *               shortPassword:
 *                 summary: Password too short
 *                 value:
 *                   success: false
 *                   error: "Password must be at least 8 characters"
 *               invalidToken:
 *                 summary: Invalid or already-used token
 *                 value:
 *                   success: false
 *                   error: "Invalid or expired reset link"
 *               expiredToken:
 *                 summary: Token expired (older than 1 hour)
 *                 value:
 *                   success: false
 *                   error: "Reset link has expired. Please request a new one."
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "An unexpected error occurred."
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password)
            return res.status(400).json({ success: false, error: 'Token and password are required' });
        if (password.length < 8)
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
        const db = await getPool();
        const result = await db.request()
            .input('token', sql.NVarChar(255), token)
            .query(`
        SELECT id, reset_expires
        FROM users
        WHERE reset_token = @token
      `);
        if (result.recordset.length === 0)
            return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
        const user = result.recordset[0];
        // ✅ Check expiry
        if (new Date() > new Date(user.reset_expires))
            return res.status(400).json({ success: false, error: 'Reset link has expired. Please request a new one.' });
        // ✅ Hash password before saving
        const bcrypt = await import('bcrypt');
        const hashed = await bcrypt.default.hash(password, 12);
        // ✅ Update password + clear reset token
        await db.request()
            .input('userId', sql.UniqueIdentifier, user.id)
            .input('password', sql.NVarChar(255), hashed)
            .query(`
        UPDATE users
        SET password      = @password,
            reset_token   = NULL,
            reset_expires = NULL
        WHERE id = @userId
      `);
        return res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
    }
    catch (err) {
        console.error('[reset-password] Error:', err);
        return res.status(500).json({ success: false, error: 'An unexpected error occurred.' });
    }
});
export default router;
