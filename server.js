// server.js — Max Inbox Edition
require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const xss        = require('xss');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── .env se credentials ──────────────────────────────────────────────────────
const ADMIN_USER = process.env.LOGIN_USER     || '1';
const ADMIN_PASS = process.env.LOGIN_PASS     || '1';
const SES_SECRET = process.env.SESSION_SECRET || 'ch@nge-this-now!';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail  = e => EMAIL_RE.test(String(e).toLowerCase());

// ── Helmet ───────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc : ["'self'", "'unsafe-inline'"],
      styleSrc  : ["'self'", "'unsafe-inline'"],
      imgSrc    : ["'self'", "data:"]
    }
  }
}));

// ── Rate limiters ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: '⏳ Too many attempts. Try after 15 min.' },
  standardHeaders: true, legacyHeaders: false
});
const sendLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  message: { success: false, message: '⏳ Too many requests. Wait 1 minute.' },
  keyGenerator: req => req.session?.user || req.ip,
  standardHeaders: true, legacyHeaders: false
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SES_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 4 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/login', loginLimiter, (req, res) => {
  const user = xss(String(req.body.username || '').trim()).slice(0, 100);
  const pass = String(req.body.password || '').trim().slice(0, 200);
  if (!user || !pass)
    return res.json({ success: false, message: '❌ Username and password required' });
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.regenerate(() => {
      req.session.user = user;
      res.json({ success: true });
    });
  } else {
    res.json({ success: false, message: '❌ Invalid credentials' });
  }
});

app.get('/launcher', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'launcher.html')));

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const delay     = ms => new Promise(r => setTimeout(r, ms));
const makeId    = domain => `<${uuidv4()}@${domain}>`;
const randDelay = () => Math.floor(Math.random() * 4000) + 4000; // 4–8 sec

// ── HTML builder ─────────────────────────────────────────────────────────────
// Plain natural email — no table, no center, no links, no images
// Exactly like a human typing in Gmail
function buildMail(rawBody, rawSubject) {
  const body    = String(rawBody    || '').trim();
  const subject = String(rawSubject || '').trim();

  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#202124;background:#ffffff;">
<div style="padding:8px 0;">${escaped}</div>
</body>
</html>`;

  return { html, text: body, subject };
}

// ── One-by-one sender with random delay ─────────────────────────────────────
// 4–8 sec random gap = human pattern, maximum inbox rate
async function sendOneByOne(transporter, mails, senderDomain) {
  const results = [];
  for (let i = 0; i < mails.length; i++) {
    // Fresh unique Message-ID for every single mail
    const mail = {
      ...mails[i],
      messageId: makeId(senderDomain)
    };
    const result = await Promise.allSettled([transporter.sendMail(mail)]);
    results.push(result[0]);
    // Random 4–8 sec delay between mails — human-like, avoids spam detection
    if (i < mails.length - 1) await delay(randDelay());
  }
  return results;
}

// ── /send ────────────────────────────────────────────────────────────────────
app.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    const senderName = xss(String(req.body.senderName || '').trim()).slice(0, 100);
    const email      = String(req.body.email     || '').trim().toLowerCase();
    const password   = String(req.body.password  || '').trim();
    const subjectRaw = xss(String(req.body.subject  || '').trim()).slice(0, 998);
    const messageRaw = String(req.body.message   || '').trim().slice(0, 50000);
    const recipients = String(req.body.recipients || '');

    if (!isEmail(email))
      return res.json({ success: false, message: '❌ Invalid sender Gmail address' });
    if (!password)
      return res.json({ success: false, message: '❌ App Password required' });
    if (!subjectRaw)
      return res.json({ success: false, message: '❌ Subject required' });
    if (!messageRaw)
      return res.json({ success: false, message: '❌ Message body required' });

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim().toLowerCase())
      .filter(r => isEmail(r));

    if (recipientList.length === 0)
      return res.json({ success: false, message: '❌ No valid recipient emails found' });
    if (recipientList.length > 500)
      return res.json({ success: false, message: '❌ Max 500 recipients allowed' });

    const senderDomain = email.split('@')[1] || 'gmail.com';
    const safeName     = senderName.replace(/[<>"]/g, '') || 'Team';

    const { html, text, subject } = buildMail(messageRaw, subjectRaw);

    // Port 587 STARTTLS — best Gmail deliverability
    const transporter = nodemailer.createTransport({
      host      : 'smtp.gmail.com',
      port      : 587,
      secure    : false,
      requireTLS: true,
      auth      : { user: email, pass: password },
      tls       : { rejectUnauthorized: true },
      socketTimeout: 20000
    });

    await transporter.verify();

    // Build mails — clean, no bulk headers, no spam signals
    const mails = recipientList.map(to => ({
      from   : `"${safeName}" <${email}>`,
      replyTo: email,
      to,
      subject,
      text,   // plain text always required
      html    // html always required
              // No Precedence:bulk — would tell filters this is bulk
              // No X-Campaign — would tell filters this is bulk
              // No List-Unsubscribe — adds bulk signal for small senders
    }));

    const results = await sendOneByOne(transporter, mails, senderDomain);
    transporter.close();

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return res.json({
      success: true,
      message: `✅ Done! Sent: ${sent}${failed > 0 ? ` | ❌ Failed: ${failed}` : ''}`
    });

  } catch (err) {
    console.error('Send error:', err.code || err.message);
    let msg = '❌ Something went wrong. Try again.';
    if (/auth|credentials|password|login/i.test(err.message))
      msg = '❌ Gmail auth failed. Use App Password — not your Gmail password.';
    else if (/ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(err.message))
      msg = '❌ Cannot connect to Gmail SMTP. Check internet.';
    return res.json({ success: false, message: msg });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`🚀 Fast Mailer → http://localhost:${PORT}`));
