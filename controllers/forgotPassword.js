import { Request, Response } from "express";
import crypto from "crypto";
import { sql, poolPromise } from "../config/db";
import { transporter } from "../utils/mail";
export const forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }
    try {
        const pool = await poolPromise;
        // Check user
        const userResult = await pool
            .request()
            .input("email", sql.NVarChar, email)
            .query(`SELECT id FROM users WHERE email = @email`);
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        // Generate token
        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetExpires = new Date(Date.now() + 1000 * 60 * 15); // 15 min
        // Save token
        await pool
            .request()
            .input("token", sql.NVarChar, resetToken)
            .input("expires", sql.DateTime2, resetExpires)
            .input("email", sql.NVarChar, email)
            .query(`
        UPDATE users
        SET reset_token = @token,
            reset_expires = @expires
        WHERE email = @email
      `);
        const resetLink = `http://localhost:5173/reset-password?token=${resetToken}`;
        // Send email
        await transporter.sendMail({
            from: `"OMAH Jobs" <${process.env.SMTP_USER}>`,
            to: email,
            subject: "Reset your password",
            html: `
        <p>You requested a password reset.</p>
        <p>Click below (valid for 15 minutes):</p>
        <a href="${resetLink}">${resetLink}</a>
      `,
        });
        return res.json({ message: "Password reset email sent" });
    }
    catch (error) {
        console.error("Forgot password error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};
//# sourceMappingURL=forgotPassword.js.map