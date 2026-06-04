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

// ✅ Per Gmail 26 mails per hour tracker
const gmailHourlyTracker = {};

function getGmailUsage(gmail) {
  const now = Date.now();
  if (!gmailHourlyTracker[gmail]) {
    gmailHourlyTracker[gmail] = { count: 0, resetAt: now + 60 * 60 * 1000 };
  }
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

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: "❌ Too many requests. Wait 1 minute." }
});

app.set('trust proxy', 1);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'safe-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000
  }
}));

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username === HARD_USERNAME && password === HARD_PASSWORD) {
    req.session.user = username;
    req.session.loginTime = Date.now();
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

app.post('/check-limit', requireAuth, (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, message: "Email required" });
  const usage = getGmailUsage(email);
  const remaining = Math.max(0, 26 - usage.count);
  const resetIn = Math.ceil((usage.resetAt - Date.now()) / 60000);
  return res.json({ success: true, used: usage.count, remaining, resetIn });
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(str) {
  return String(str || '').replace(/[<>]/g, '').trim();
}

async function sendBatch(transporter, mails, batchSize = 3) {
  const results = [];
  for (let i = 0; i < mails.length; i += batchSize) {
    const batch = mails.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );
    results.push(...settled);
    if (i + batchSize < mails.length) await delay(600);
  }
  return results;
}

// ✅ Send route
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

    // 26 mail/hour limit
    const usage = getGmailUsage(email);
    if (usage.count >= 26) {
      const resetIn = Math.ceil((usage.resetAt - Date.now()) / 60000);
      return res.json({
        success: false,
        message: `🚫 Mail Limit Full! ${resetIn} minute baad try karo.`
      });
    }

    const allowed = 26 - usage.count;
    if (recipientList.length > allowed) {
      return res.json({
        success: false,
        message: `🚫 Mail Limit Full! Sirf ${allowed} aur mail bhej sakte ho is ghante mein.`
      });
    }

    // ✅ Gmail SMTP
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: email,
        pass: password
      },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      tls: { rejectUnauthorized: false }
    });

    await transporter.verify();

    const cleanName    = sanitize(senderName) || 'Team';
    const cleanSubject = sanitize(subject);
    const cleanMessage = sanitize(message);

    // ✅ Plain text only — spam kam hoga
    const mails = recipientList.map(r => ({
      from: `"${cleanName}" <${email}>`,
      to: r,
      subject: cleanSubject,
      text: cleanMessage
    }));

    const results = await sendBatch(transporter, mails, 3);

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    usage.count += sent;

    const remaining = Math.max(0, 26 - usage.count);
    const resetIn   = Math.ceil((usage.resetAt - Date.now()) / 60000);

    console.log(`[${new Date().toISOString()}] Sent:${sent} Failed:${failed} Gmail:${email}`);

    return res.json({
      success: true,
      message: `✅ ${sent} emails bheje! ${failed > 0 ? `❌ ${failed} fail hue.` : ''} | 📊 Baaki: ${remaining}/26 (${resetIn} min mein reset)`
    });

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);

    if (err.message.includes('Invalid login') ||
        err.message.includes('Username and Password')) {
      return res.json({ success: false, message: "❌ Gmail ya App Password galat hai." });
    }
    if (err.message.includes('ECONNREFUSED') ||
        err.message.includes('ETIMEDOUT')) {
      return res.json({ success: false, message: "❌ Internet ya Gmail server issue." });
    }

    return res.json({ success: false, message: "❌ Error: " + err.message });
  }
});

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.message);
  res.status(500).json({ success: false, message: "Server error." });
});

app.listen(PORT, () => {
  console.log(`🚀 Safe Mailer → http://localhost:${PORT}`);
  console.log(`📅 Started: ${new Date().toISOString()}`);
});
