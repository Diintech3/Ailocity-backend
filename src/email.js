const { BrevoClient } = require('@getbrevo/brevo')

const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY })

const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'brahmakoshtech@gmail.com'
const FROM_NAME  = process.env.BREVO_FROM_NAME  || 'Ailocity'

async function sendMeetingEmail({ to, toName, subject, html }) {
  if (!to || !to.trim()) return
  if (process.env.EMAIL_ENABLED !== 'true') return
  try {
    const result = await client.transactionalEmails.sendTransacEmail({
      sender:      { name: FROM_NAME, email: FROM_EMAIL },
      to:          [{ email: to.trim(), name: toName || to.trim() }],
      subject,
      htmlContent: html,
    })
    console.log('[Email] Sent to', to, '| messageId:', result?.body?.messageId)
  } catch (err) {
    console.error('[Email] Failed to send to', to, err?.message)
  }
}

function meetingEmailHtml({ title, rows, note }) {
  const rowsHtml = rows
    .map(([label, value]) => `
      <tr>
        <td style="padding:9px 14px;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;border-bottom:1px solid #f1f5f9;width:38%;">${label}</td>
        <td style="padding:9px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;">${value || '—'}</td>
      </tr>`)
    .join('')

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 0;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#FF7A00,#FFB000);padding:26px 30px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#fff;">📅 ${title}</p>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Ailocity — Meeting Notification</p>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
              ${rowsHtml}
            </table>
            ${note ? `
            <div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;">
              <p style="margin:0 0 5px;font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:0.06em;">Note</p>
              <p style="margin:0;font-size:13px;color:#0f172a;line-height:1.6;">${note}</p>
            </div>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:14px 30px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">This is an automated notification from <strong style="color:#FF7A00;">Ailocity</strong></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

module.exports = { sendMeetingEmail, meetingEmailHtml }
