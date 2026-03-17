import nodemailer from "nodemailer";

// =========================
// Validate environment variables
// =========================
if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.warn("⚠️ SMTP environment variables are missing.");
}

// =========================
// Create transporter (once)
// =========================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465, // true if 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// =========================
// Verify SMTP connection
// =========================
transporter.verify((err, success) => {
  if (err) {
    console.error("❌ SMTP connection error:", err);
  } else {
    console.log("✅ SMTP server is ready to send emails");
  }
});

// =========================
// Send Reset Password Email
// =========================
export const sendResetEmail = async (to, name, resetLink) => {
  try {
    if (!to || !resetLink) {
      throw new Error("Missing email or reset link");
    }

    const mailOptions = {
      from: `"OMAH Support" <${process.env.SMTP_USER}>`,
      to,
      subject: "Reset Your Password",
      html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f6f8;padding:40px 0;">
        
        <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;padding:40px;">
          
          <h2 style="color:#0078D4;margin-bottom:10px;">
            Hello ${name || "User"},
          </h2>

          <p style="color:#444;font-size:16px;">
            We received a request to reset your password for your 
            <strong>OMAH account</strong>.
          </p>

          <p style="color:#444;font-size:16px;">
            Click the button below to create a new password.
          </p>

          <div style="text-align:center;margin:35px 0;">
            <a href="${resetLink}" 
              style="
                background:#0078D4;
                color:#ffffff;
                padding:14px 28px;
                text-decoration:none;
                border-radius:6px;
                font-size:16px;
                font-weight:600;
                display:inline-block;
              ">
              Reset Password
            </a>
          </div>

          <p style="color:#777;font-size:14px;">
            This link will expire in <strong>1 hour</strong> for security reasons.
          </p>

          <p style="color:#777;font-size:14px;">
            If you did not request this password reset, you can safely ignore this email.
          </p>

          <hr style="border:none;border-top:1px solid #eee;margin:30px 0;">

          <p style="font-size:12px;color:#999;">
            This is an automated message from 
            <strong>OpenMindsAI Hamburg (OMAH)</strong>.
            Please do not reply to this email.
          </p>

        </div>

      </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log("📧 Password reset email sent:", info.messageId);

    return true;
  } catch (error) {
    console.error("❌ Failed to send reset email:", error);
    throw error;
  }
};