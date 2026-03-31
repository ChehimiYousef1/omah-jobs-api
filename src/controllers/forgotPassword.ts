import { Request, Response } from "express";
import crypto from "crypto";
import { sql, poolPromise } from "../config/db"; // Make sure these are exported in db.ts
import { sendResetEmail } from "../utils/mail";  // Use your existing sendResetEmail function

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const pool = await poolPromise;

    // Check if user exists
    const userResult = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(`SELECT id, name FROM users WHERE email = @email`);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.recordset[0];

    // Generate token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // Save token to DB
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

    // Send reset email
    await sendResetEmail(email, user.name || "there", resetLink);

    return res.json({ message: "Password reset email sent" });
  } catch (error: any) {
    console.error("Forgot password error:", error.message || error);
    return res.status(500).json({ message: "Internal server error" });
  }
};