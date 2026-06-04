require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

const HARD_USERNAME = process.env.LOGIN_USER || "1";
const HARD_PASSWORD = process.env.LOGIN_PASS || "1";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "❌ Too many attempts. Try after 15 min." }
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: "❌ Too many send requests. Wait 1 minute." }
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-super-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 2 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username === HARD_USERNAME && password === HARD_PASSWORD) {
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.json({ success: false, message: "❌ Invalid credentials" });
});

app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendBatch(transporter, mails, batchSize = 3) {
  const results = [];
  for (let i = 0; i < mails.length; i += batchSize) {
    const batch = mails.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
    results.push(...settled);
    if (i + batchSize < mails.length) await delay(500);
  }
  return results;
}

app.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body;

    if (!email || !password || !recipients || !subject || !message) {
      return res.json({ success: false, message: "❌ Sab fields required hain." });
    }

    if (!isValidEmail(email)) {
      return res.json({ success: false, message: "❌ Invalid Gmail address." });
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r && isValidEmail(r));

    if (recipientList.length === 0) {
      return res.json({ success: false, message: "❌ Koi valid recipient nahi mila." });
    }

    if (recipientList.length > 500) {
      return res.json({ success: false, message: "❌ Max 500 recipients allowed." });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password },
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
      tls: { rejectUnauthorized: false }
    });

    await transporter.verify();

    const mails = recipientList.map(r => ({
      from: `"${(senderName || 'Mail Team').replace(/[<>]/g, '')}" <${email}>`,
      to: r,
      subject: subject,
      text: message,
      html: `
        <div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.7;max-width:600px;">
          ${message.replace(/\n/g, '<br>')}
          <br><br>
          <hr style="border:none;border-top:1px solid #eee;">
          <p style="color:#999;font-size:11px;">Sent by ${senderName || email}</p>
        </div>
      `,
      headers: { 'X-Mailer': 'Nodemailer', 'X-Priority': '3' }
    }));

    const results = await sendBatch(transporter, mails, 3);
    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return res.json({
      success: true,
      message: `✅ ${sent} emails bheje! ${failed > 0 ? `❌ ${failed} fail hue.` : ''}`
    });

  } catch (err) {
    console.error("Send error:", err.message);
    if (err.message.includes('Invalid login') || err.message.includes('Username and Password')) {
      return res.json({ success: false, message: "❌ Gmail ya App Password galat hai." });
    }
    return res.json({ success: false, message: "❌ Error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Fast Mailer running → http://localhost:${PORT}`);
});
