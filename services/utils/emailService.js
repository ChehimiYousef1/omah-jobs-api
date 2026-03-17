import nodemailer from 'nodemailer';
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const META = {
    LIKE: { emoji: '👍', color: '#2563eb', subject: a => `${a} liked your post`, headline: a => `<strong>${a}</strong> liked your post` },
    COMMENT: { emoji: '💬', color: '#7c3aed', subject: a => `${a} commented on your post`, headline: a => `<strong>${a}</strong> commented on your post` },
    MENTION: { emoji: '🔔', color: '#0891b2', subject: a => `${a} mentioned you in a comment`, headline: a => `<strong>${a}</strong> mentioned you in a comment` },
    REPOST: { emoji: '🔁', color: '#059669', subject: a => `${a} reposted your post`, headline: a => `<strong>${a}</strong> reposted your post` },
    FOLLOW: { emoji: '👥', color: '#d97706', subject: a => `${a} started following you`, headline: a => `<strong>${a}</strong> started following you` },
    MESSAGE: { emoji: '📨', color: '#dc2626', subject: a => `${a} sent you a message`, headline: a => `<strong>${a}</strong> sent you a message` },
};
function buildHtml(p) {
    const m = META[p.type];
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${m.subject(p.actorName)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${m.color},${m.color}cc);padding:28px 32px;text-align:center;">
            <div style="font-size:36px;margin-bottom:6px;">${m.emoji}</div>
            <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-.3px;">OMAH Connect</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 20px;font-size:15px;color:#374151;">
              Hi <strong>${p.toName}</strong>,
            </p>

            <!-- Notification card -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:24px;">
              <tr>
                <td style="padding:4px 0 0 0;background:${m.color};height:4px;"></td>
              </tr>
              <tr>
                <td style="padding:20px 24px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-right:14px;vertical-align:top;">
                        ${p.actorAvatar
        ? `<img src="${p.actorAvatar}" width="44" height="44" style="border-radius:50%;object-fit:cover;border:2px solid ${m.color};" alt="${p.actorName}"/>`
        : `<div style="width:44px;height:44px;border-radius:50%;background:${m.color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;text-align:center;line-height:44px;">${p.actorName[0].toUpperCase()}</div>`}
                      </td>
                      <td style="vertical-align:middle;">
                        <p style="margin:0;font-size:15px;color:#1e293b;line-height:1.5;">
                          ${m.headline(p.actorName)}
                        </p>
                        ${p.postTitle ? `<p style="margin:4px 0 0;font-size:13px;color:#64748b;">on: <em>"${p.postTitle}"</em></p>` : ''}
                      </td>
                    </tr>
                  </table>

                  ${p.commentBody ? `
                  <div style="margin-top:16px;padding:12px 16px;background:#ffffff;border-left:3px solid ${m.color};
                    border-radius:0 8px 8px 0;font-size:14px;color:#475569;font-style:italic;line-height:1.6;">
                    "${p.commentBody}"
                  </div>` : ''}
                </td>
              </tr>
            </table>

            <!-- CTA -->
            ${p.postUrl ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td align="center">
                  <a href="${p.postUrl}"
                    style="display:inline-block;background:${m.color};color:#ffffff;text-decoration:none;
                    padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px;">
                    View Post →
                  </a>
                </td>
              </tr>
            </table>` : ''}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
              You received this because you have notifications enabled on OMAH Connect.<br/>
              <a href="${appUrl}/settings/notifications" style="color:#64748b;text-decoration:underline;">
                Manage notification preferences
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
export async function sendNotificationEmail(payload) {
    try {
        const m = META[payload.type];
        await transporter.sendMail({
            from: `"OMAH Connect" <${process.env.SMTP_USER}>`,
            to: payload.toEmail,
            subject: m.subject(payload.actorName),
            html: buildHtml(payload),
        });
    }
    catch (err) {
        // Never crash the API — email is best-effort
        console.error('[emailService] send failed:', err);
    }
}
//# sourceMappingURL=emailService.js.map