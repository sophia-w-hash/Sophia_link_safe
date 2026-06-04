require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 8080;

// ✅ Credentials
const HARD_USERNAME = process.env.LOGIN_USER || "1";
const HARD_PASSWORD = process.env.LOGIN_PASS || "1";

// ============================================================
// ✅ Per Gmail — 26 mails per hour tracker
// ============================================================
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

// ============================================================
// ✅ Rate Limiters
// ============================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "❌ Too many login attempts. Try after 15 min." }
});

const sendLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "❌ Too many send requests. Wait 2 minutes." }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "❌ Too many requests." }
});

// ============================================================
// ✅ App Config
// ============================================================
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// ============================================================
// ✅ Security Headers
// ============================================================
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ============================================================
// ✅ Session
// ============================================================
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  name: 'sid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000 // 1 hour auto logout
  }
}));

// ============================================================
// ✅ Auth Middleware
// ============================================================
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/');
  }
  // ✅ Session timeout check
  const now = Date.now();
  if (req.session.loginTime && now - req.session.loginTime > 60 * 60 * 1000) {
    req.session.destroy(() => {});
    return res.redirect('/');
  }
  return next();
}

// ============================================================
// ✅ Helper Functions
// ============================================================
function isValidEmail(email) {
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email);
}

function sanitize(str) {
  return String(str || '')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

// ✅ Random delay 3 to 6 seconds between each mail
function randomDelay() {
  const ms = Math.floor(Math.random() * 3000) + 3000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Send one by one — human-like slow sending
async function sendOneByOne(transporter, mails) {
  const results = [];
  for (let i = 0; i < mails.length; i++) {
    try {
      await transporter.sendMail(mails[i]);
      results.push({ status: 'fulfilled' });
      console.log(`[${new Date().toISOString()}] ✅ Sent ${i + 1}/${mails.length} → ${mails[i].to}`);
    } catch (err) {
      results.push({ status: 'rejected', reason: err.message });
      console.log(`[${new Date().toISOString()}] ❌ Failed ${i + 1}/${mails.length} → ${mails[i].to}`);
    }
    if (i < mails.length - 1) await randomDelay();
  }
  return results;
}

// ============================================================
// ✅ Routes
// ============================================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Home
app.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login
app.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "❌ Username aur password required." });
  }

  if (
    username === HARD_USERNAME &&
    password === HARD_PASSWORD
  ) {
    req.session.regenerate((err) => {
      if (err) return res.json({ success: false, message: "❌ Session error." });
      req.session.user      = username;
      req.session.loginTime = Date.now();
      return res.json({ success: true });
    });
  } else {
    return res.json({ success: false, message: "❌ Invalid credentials." });
  }
});

// Launcher page
app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    return res.json({ success: true });
  });
});

// Check limit
app.post('/check-limit', requireAuth, apiLimiter, (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    return res.json({ success: false, message: "Valid email required." });
  }
  const usage    = getGmailUsage(email);
  const remaining = Math.max(0, 26 - usage.count);
  const resetIn  = Math.ceil((usage.resetAt - Date.now()) / 60000);
  return res.json({ success: true, used: usage.count, remaining, resetIn });
});

// ============================================================
// ✅ Send Route
// ============================================================
app.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    const {
      senderName, email, password,
      recipients, subject, message
    } = req.body;

    // ✅ All fields required
    if (!email || !password || !recipients || !subject || !message) {
      return res.json({ success: false, message: "❌ Sab fields required hain." });
    }

    // ✅ Gmail validation
    if (!isValidEmail(email)) {
      return res.json({ success: false, message: "❌ Invalid Gmail address." });
    }

    // ✅ App password length check
    const cleanPass = sanitize(password);
    if (cleanPass.length < 8) {
      return res.json({ success: false, message: "❌ App Password too short." });
    }

    // ✅ Subject length check
    if (sanitize(subject).length > 150) {
      return res.json({ success: false, message: "❌ Subject too long. Max 150 chars." });
    }

    // ✅ Message length check
    if (sanitize(message).length > 5000) {
      return res.json({ success: false, message: "❌ Message too long. Max 5000 chars." });
    }

    // ✅ Parse recipients
    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim().toLowerCase())
      .filter(r => r && isValidEmail(r));

    // ✅ Remove duplicates
    const uniqueList = [...new Set(recipientList)];

    if (uniqueList.length === 0) {
      return res.json({ success: false, message: "❌ Koi valid recipient nahi mila." });
    }

    if (uniqueList.length > 500) {
      return res.json({ success: false, message: "❌ Max 500 recipients allowed." });
    }

    // ✅ 26 mail/hour limit
    const usage = getGmailUsage(email);
    if (usage.count >= 26) {
      const resetIn = Math.ceil((usage.resetAt - Date.now()) / 60000);
      return res.json({
        success: false,
        message: `🚫 Mail Limit Full! ${resetIn} minute baad try karo.`
      });
    }

    const allowed = 26 - usage.count;
    if (uniqueList.length > allowed) {
      return res.json({
        success: false,
        message: `🚫 Mail Limit Full! Sirf ${allowed} aur mail bhej sakte ho is ghante mein.`
      });
    }

    // ✅ Gmail SMTP — port 587 TLS
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: email,
        pass: cleanPass
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      },
      connectionTimeout: 10000,
      greetingTimeout:   10000,
      socketTimeout:     20000
    });

    // ✅ Verify credentials
    await transporter.verify();

    const cleanName    = sanitize(senderName) || 'Team';
    const cleanSubject = sanitize(subject);
    const cleanMessage = sanitize(message);

    // ✅ Plain text only — inbox friendly
    const mails = uniqueList.map(r => ({
      from: `"${cleanName}" <${email}>`,
      to: r,
      subject: cleanSubject,
      text: cleanMessage,
      envelope: {
        from: email,
        to: r
      }
    }));

    // ✅ Send one by one with random delay
    const results = await sendOneByOne(transporter, mails);

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    // Update usage
    usage.count += sent;

    const remaining = Math.max(0, 26 - usage.count);
    const resetIn   = Math.ceil((usage.resetAt - Date.now()) / 60000);

    console.log(`[${new Date().toISOString()}] ✅ Total Sent:${sent} ❌ Failed:${failed} Gmail:${email}`);

    return res.json({
      success: true,
      message: `✅ ${sent} emails bheje! ${failed > 0 ? `❌ ${failed} fail hue.` : ''} | 📊 Baaki: ${remaining}/26 (${resetIn} min mein reset)`
    });

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);

    if (err.message.includes('Invalid login') ||
        err.message.includes('Username and Password') ||
        err.message.includes('BadCredentials')) {
      return res.json({ success: false, message: "❌ Gmail ya App Password galat hai." });
    }
    if (err.message.includes('ECONNREFUSED') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ENOTFOUND')) {
      return res.json({ success: false, message: "❌ Internet ya Gmail server issue." });
    }
    if (err.message.includes('rate limit') ||
        err.message.includes('too many')) {
      return res.json({ success: false, message: "❌ Gmail rate limit. Thodi der baad try karo." });
    }

    return res.json({ success: false, message: "❌ Error: " + err.message });
  }
});

// ============================================================
// ✅ 404 + Global Error Handler
// ============================================================
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Global Error:`, err.message);
  res.status(500).json({ success: false, message: "Server error." });
});

// ============================================================
// ✅ Start Server
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Safe Mailer → http://localhost:${PORT}`);
  console.log(`📅 Started: ${new Date().toISOString()}`);
});
