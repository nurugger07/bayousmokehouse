const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function sendContactNotification({ message, detailUrl }) {
  const transporter = getTransporter();

  if (!transporter) {
    console.log('Email notifications not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing) — skipping.');
    return;
  }

  const recipient = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: recipient,
    subject: `New contact message from ${message.name}`,
    text: [
      `Name: ${message.name}`,
      `Email: ${message.email}`,
      message.phone ? `Phone: ${message.phone}` : null,
      '',
      message.message,
      '',
      `View this message: ${detailUrl}`,
    ]
      .filter(Boolean)
      .join('\n'),
  });

  console.log(`Contact notification email sent to ${recipient} for message #${message.id}.`);
}

// Generic admin alert email, reused by the daily tax-toggle job (no
// calendar match, or a dry-run summary) and the upcoming monthly
// tax-payment-due reminder — anything that just needs a subject and a
// plain-text body sent to the same admin inbox as contact notifications.
async function sendAdminAlert({ subject, body }) {
  const transporter = getTransporter();

  if (!transporter) {
    console.log('Email notifications not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing) — skipping.');
    return;
  }

  const recipient = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: recipient,
    subject,
    text: body,
  });

  console.log(`Admin alert email sent to ${recipient}: ${subject}`);
}

module.exports = { sendContactNotification, sendAdminAlert };
