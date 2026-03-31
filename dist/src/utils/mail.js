import nodemailer from 'nodemailer';
export const sendResetEmail = async (to, name, resetLink) => {
    const mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false, // true for 465, false for 587
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
    await mailer.sendMail({
        from: `"OMAH Support" <${process.env.SMTP_USER}>`,
        to,
        subject: 'Reset Your Password',
        html: `
      <div style="font-family: 'Segoe UI', sans-serif; background:#f4f6f8; padding:40px 0;">
        <div style="max-width:600px; margin:0 auto; background:#fff; padding:30px; border-radius:8px;">
          <h2 style="color:#0078D4;">Hi ${name},</h2>
          <p>We received a request to reset your password. Click the button below to create a new password.</p>
          <p>This link expires in 1 hour.</p>
          <p style="text-align:center; margin:30px 0;">
            <a href="${resetLink}" style="background:#0078D4; color:#fff; padding:12px 30px; border-radius:6px; text-decoration:none; display:inline-block;">
              Reset Password
            </a>
          </p>
          <p style="font-size:14px; color:#666; margin-top:30px;">
            If you didn't request this password reset, you can safely ignore this email. 
            Your password will remain unchanged.
          </p>
          <hr style="border:none; border-top:1px solid #eee; margin:30px 0;">
          <p style="font-size:12px; color:#999;">
            This is an automated message, please do not reply to this email.
          </p>
        </div>
      </div>
    `,
    });
};
