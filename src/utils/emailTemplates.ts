import { APPOINTMENT_RULES } from '../config/appointmentRules.js';

const BRAND = '#0f766e';

export type EmailMessage =
  | { template: 'WELCOME_VERIFY'; data: { name: string; verifyUrl: string; token: string } }
  | { template: 'PASSWORD_RESET'; data: { name: string; resetUrl: string; token: string; expiresMinutes: number } }
  | { template: 'OFFICER_INVITE'; data: { name: string; roleLabel: string; officeName: string | null; inviteUrl: string; token: string; expiresHours: number } }
  | {
      template: 'APPOINTMENT_CONFIRMATION';
      data: {
        name: string;
        serviceName: string;
        officeName: string;
        address: string | null;
        date: string;
        time: string;
        mandatoryDocs: string[];
        optionalDocs: string[];
        isReschedule: boolean;
      };
    };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(params: { title: string; preheader: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold;">Mekoya</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.5;">${params.bodyHtml}</td></tr>
<tr><td style="padding:16px 28px;background:#fafafa;font-size:12px;color:#71717a;">This is an automated message from Mekoya. Please do not reply.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">${escapeHtml(label)}</a></p>`;
}

function codeBlock(value: string): string {
  return `<p style="margin:8px 0;padding:10px;background:#f4f4f5;border-radius:4px;font-family:Consolas,monospace;font-size:13px;word-break:break-all;">${escapeHtml(value)}</p>`;
}

function docList(items: string[], label: string): string {
  if (!items.length) {
    return `<p style="margin:8px 0;color:#52525b;">No ${label} required.</p>`;
  }

  return `<ul style="margin:8px 0 16px;padding-left:20px;">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('')}</ul>`;
}

export function renderEmail(message: EmailMessage): RenderedEmail {
  switch (message.template) {
    case 'WELCOME_VERIFY': {
      const { name, verifyUrl, token } = message.data;
      const subject = 'Welcome to Mekoya: please verify your email';
      const html = layout({
        title: subject,
        preheader: 'Verify your email to start booking appointments.',
        bodyHtml: `
<h1 style="font-size:22px;margin:0 0 16px;">Welcome, ${escapeHtml(name)}!</h1>
<p>Thanks for joining Mekoya. Please confirm your email address so you can book appointments.</p>
${button(verifyUrl, 'Verify my email')}
<p style="font-size:14px;color:#52525b;">Using the API directly? Send this token to <code>POST /auth/verify-email</code>:</p>
${codeBlock(token)}
<p style="font-size:14px;color:#52525b;">This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
      });
      const text = `Welcome, ${name}!\n\nVerify your email: ${verifyUrl}\n\nAPI token: ${token}\n\nThis link expires in 24 hours. If you did not create an account, ignore this email.`;
      return { subject, html, text };
    }

    case 'PASSWORD_RESET': {
      const { name, resetUrl, token, expiresMinutes } = message.data;
      const subject = 'Reset your Mekoya password';
      const html = layout({
        title: subject,
        preheader: 'Use this link to choose a new password.',
        bodyHtml: `
<h1 style="font-size:22px;margin:0 0 16px;">Password reset</h1>
<p>Hi ${escapeHtml(name)}, we received a request to reset your password.</p>
${button(resetUrl, 'Choose a new password')}
<p style="font-size:14px;color:#52525b;">Using the API directly? Send this token to <code>POST /auth/reset-password</code>:</p>
${codeBlock(token)}
<p style="font-size:14px;color:#52525b;">This link expires in ${expiresMinutes} minutes. If you did not ask for this, ignore this email. Your password stays unchanged.</p>`,
      });
      const text = `Hi ${name},\n\nReset your password: ${resetUrl}\n\nAPI token: ${token}\n\nThis link expires in ${expiresMinutes} minutes. If you did not ask for this, ignore this email.`;
      return { subject, html, text };
    }

    case 'OFFICER_INVITE': {
      const { name, roleLabel, officeName, inviteUrl, token, expiresHours } = message.data;
      const subject = 'You have been invited to Mekoya';
      const where = officeName ? ` at ${officeName}` : '';
      const html = layout({
        title: subject,
        preheader: 'Set your password to activate your staff account.',
        bodyHtml: `
<h1 style="font-size:22px;margin:0 0 16px;">Welcome to the team, ${escapeHtml(name)}</h1>
<p>You have been added to Mekoya as <strong>${escapeHtml(roleLabel)}</strong>${escapeHtml(where)}. Set your password to activate your account.</p>
${button(inviteUrl, 'Set my password')}
<p style="font-size:14px;color:#52525b;">Using the API directly? Send this token to <code>POST /auth/accept-invite</code>:</p>
${codeBlock(token)}
<p style="font-size:14px;color:#52525b;">This invitation expires in ${expiresHours} hours.</p>`,
      });
      const text = `Welcome, ${name}!\n\nYou were added to Mekoya as ${roleLabel}${where}.\nSet your password: ${inviteUrl}\n\nAPI token: ${token}\n\nThis invitation expires in ${expiresHours} hours.`;
      return { subject, html, text };
    }

    case 'APPOINTMENT_CONFIRMATION': {
        const d = message.data;
        const subject = d.isReschedule ? 'Your Mekoya appointment was rescheduled' : 'Your Mekoya appointment is booked';
        const items = (list: string[]): string => list.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        const row = (label: string, value: string): string =>
        `<tr><td style="padding:4px 16px 4px 0;color:#52525b;">${label}</td><td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`;
        const cutoff = APPOINTMENT_RULES.cancelCutoffHours;

        const html = layout({
            title: subject,
            preheader: `${d.serviceName} on ${d.date} at ${d.time}`,
            bodyHtml: `
    <h1 style="font-size:22px;margin:0 0 16px;">${d.isReschedule ? 'Appointment rescheduled' : 'Appointment booked'}</h1>
    <p>Hi ${escapeHtml(d.name)}, here are your appointment details:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:16px;">
    ${row('Service', d.serviceName)}
    ${row('Office', d.officeName)}
    ${d.address ? row('Address', d.address) : ''}
    ${row('Date', d.date)}
    ${row('Time', `${d.time} (Addis Ababa time)`)}
    </table>
    <p><strong>Please upload these documents before your visit:</strong></p>
    <ul>${items(d.mandatoryDocs)}</ul>
    ${d.optionalDocs.length > 0 ? `<p>Optional:</p><ul>${items(d.optionalDocs)}</ul>` : ''}
    <p style="font-size:14px;color:#52525b;">You can cancel or reschedule up to ${cutoff} hours before your appointment.</p>`,
        });

      const text = [
        `Hi ${d.name},`,
        '',
        d.isReschedule ? 'Your appointment was rescheduled.' : 'Your appointment is booked.',
        `Service: ${d.serviceName}`,
        `Office: ${d.officeName}${d.address ? `, ${d.address}` : ''}`,
        `When: ${d.date} ${d.time} (Addis Ababa time)`,
        '',
        'Documents to upload before your visit:',
        ...d.mandatoryDocs.map((doc) => `- ${doc}`),
        ...(d.optionalDocs.length > 0 ? ['Optional:', ...d.optionalDocs.map((doc) => `- ${doc}`)] : []),
        '',
        `You can cancel or reschedule up to ${cutoff} hours before.`,
      ].join('\n');

      return { subject, html, text };
    }
    default: {
      const unreachable: never = message;
      throw new Error(`Unhandled email template: ${JSON.stringify(unreachable)}`);
    }
  }
}