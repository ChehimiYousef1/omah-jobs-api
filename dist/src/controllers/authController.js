import crypto from 'crypto';
import sql from 'mssql';
import { sendResetEmail } from '../utils/mail.js';
import { getPool } from '../config/db.js'; // or wherever your pool helper is
export async function forgotPassword(req, res) {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 15 * 60 * 1000);
        const pool = await getPool();
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .input('token', sql.NVarChar, token)
            .input('expires', sql.DateTime2, expires)
            .query(`
        UPDATE users
        SET reset_token = @token, reset_expires = @expires
        WHERE email = @email
      `);
        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
        await sendResetEmail(email, resetLink);
        res.json({ success: true });
    }
    catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ message: 'Server error' });
    }
}
