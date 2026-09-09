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
}

module.exports = { sendContactNotification };
