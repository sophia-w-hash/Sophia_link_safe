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

// ✅ Per Gmail account — 26 mails per hour tracker
const gmailHourlyTracker = {};

function getGmailUsage(gmail) {
  const now = Date.now();
  if (!gmailHourlyTracker[gmail]) {
    gmailHourlyTracker[gmail] = { count: 0, resetAt: now + 60 * 60 * 1000 };
  }
  // Reset if 1 hour passed
  if (now > gmailHourlyTracker[gmail].resetAt) {
    gmailHourlyTracker[gmail] = { count: 0, resetAt: now + 60 * 60 * 1000 };
  }
  return gmailHourlyTracker[gmail];
}

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "❌ Too many attempts. Try after 15 min." }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'safe-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 60 * 60 * 1000 // ✅ 1 hour auto logout
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

// Routes
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

// ✅ Check remaining limit API
app.post('/check-limit', requireAuth, (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, message: "Email required" });
  const usage = getGmailUsage(email);
  const remaining = 26 - usage.count;
  const resetIn = Math.ceil((usage.resetAt - Date.now()) / 60000);
  return res.json({ success: true, remaining, resetIn });
});

// Helpers
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

// ✅ Send route
app.post('/send', requireAuth, async (req, res) => {
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

    // ✅ 26 mail per hour limit check
    const usage = getGmailUsage(email);
    if (usage.count >= 26) {
      const resetIn = Math.ceil((usage.resetAt - Date.now()) / 60000);
      return res.json({
        success: false,
        message: `🚫 Mail Limit Full! Is Gmail se is ghante mein aur mail nahi bhej sakte. ${resetIn} minute baad try karo.`
      });
    }

    const allowed = 26 - usage.count;
    if (recipientList.length > allowed) {
      return res.json({
        success: false,
        message: `🚫 Mail Limit Full! Sirf ${allowed} aur mail bhej sakte ho is ghante mein.`
      });
    }

    if (recipientList.length > 500) {
      return res.json({ success: false, message: "❌ Max 500 recipients allowed." });
    }

    // Gmail SMTP
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      tls: { rejectUnauthorized: false }
    });

    await transporter.verify();

    const mails = recipientList.map(r => ({
      from: `"${(senderName || 'Team').replace(/[<>]/g, '')}" <${email}>`,
      to: r,
      subject: subject,
      text: message,
      html: `
        <div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.8;max-width:600px;margin:auto;padding:24px;">
          <p>${message.replace(/\n/g, '<br>')}</p>
          <br>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="color:#aaa;font-size:11px;text-align:center;">
            Sent by ${(senderName || email).replace(/[<>]/g, '')}
          </p>
        </div>
      `,
      headers: {
        'X-Mailer': 'Nodemailer',
        'X-Priority': '3',
        'Precedence': 'bulk'
      }
    }));

    const results = await sendBatch(transporter, mails, 3);

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    // ✅ Update count only for sent mails
    usage.count += sent;

    const remaining = 26 - usage.count;
    const resetIn = Math.ceil((usage.resetAt - Date.now()) / 60000);

    return res.json({
      success: true,
      message: `✅ ${sent} emails bheje! ${failed > 0 ? `❌ ${failed} fail hue.` : ''} | 📊 Baaki limit: ${remaining}/26 (${resetIn} min mein reset)`
    });

  } catch (err) {
    console.error("Send error:", err.message);
    if (err.message.includes('Invalid login') || err.message.includes('Username and Password')) {
      return res.json({ success: false, message: "❌ Gmail ya App Password galat hai." });
    }
    if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
      return res.json({ success: false, message: "❌ Internet ya Gmail server issue hai." });
    }
    return res.json({ success: false, message: "❌ Error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Safe Mailer → http://localhost:${PORT}`);
});
