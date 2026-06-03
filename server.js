// server.js — Fast + Max Inbox Edition
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
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 8080;

const ADMIN_USER = process.env.LOGIN_USER     || 'admin';
const ADMIN_PASS = process.env.LOGIN_PASS     || 'Admin@1234';
const SES_SECRET = process.env.SESSION_SECRET || 'ch@nge-this-now!';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail  = e => EMAIL_RE.test(String(e).toLowerCase());

// ─── Helmet ───────────────────────────────────────────────────────────────────
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

// ─── Rate limiters ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: '⏳ Too many attempts. Try after 15 min.' },
  standardHeaders: true, legacyHeaders: false
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  message: { success: false, message: '⏳ Too many send requests. Wait 1 minute.' },
  keyGenerator: req => req.session?.user || req.ip,
  standardHeaders: true, legacyHeaders: false
});

// ─── Middleware ───────────────────────────────────────────────────────────────
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

// ─── Routes ───────────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));
const makeMessageId = domain => `<${uuidv4()}@${domain}>`;

// ─── Spam word replacer ───────────────────────────────────────────────────────
// Common spam-trigger words replaced with neutral equivalents
const SPAM_MAP = [
  [/\bfree\b/gi,          'complimentary'],
  [/\bcash\b/gi,          'funds'],
  [/\bmoney\b/gi,         'amount'],
  [/\bwin\b/gi,           'receive'],
  [/\bwinner\b/gi,        'selected recipient'],
  [/\boffer\b/gi,         'opportunity'],
  [/\bguaranteed\b/gi,    'confirmed'],
  [/\burgent\b/gi,        'important'],
  [/\bclick here\b/gi,    'see details below'],
  [/\bact now\b/gi,       'kindly review'],
  [/\blimited time\b/gi,  'currently available'],
  [/\bdiscount\b/gi,      'reduced rate'],
  [/\b100%\b/gi,          'fully'],
  [/\bearning\b/gi,       'receiving'],
  [/\bprofit\b/gi,        'benefit'],
  [/\bprize\b/gi,         'reward'],
  [/\bbonus\b/gi,         'additional benefit'],
  [/\bpromote\b/gi,       'share'],
  [/\bmarketing\b/gi,     'communication'],
  [/\bbuy now\b/gi,       'learn more'],
  [/\border now\b/gi,     'get started'],
];

function replaceSafeWords(text) {
  let out = text;
  for (const [pat, rep] of SPAM_MAP) out = out.replace(pat, rep);
  return out;
}

// ─── Clean HTML template — plain natural email like a normal Gmail message ────
function buildMail(bodyRaw, subjectRaw) {
  const body    = replaceSafeWords(bodyRaw);
  const subject = replaceSafeWords(subjectRaw);

  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  // Plain style — no centering, no wrapper table, starts from top-left
  // exactly like a normal human-written Gmail message
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a;">
  <div style="padding:12px 16px;">
    ${escaped}
  </div>
</body>
</html>`;

  return { html, text: body, subject };
}

// ─── Fast sender — 3 parallel, 600ms gap, fresh Message-ID per mail ──────────
// Speed: ~180–200 mails/min — fast and Gmail-safe
async function sendFast(transporter, mails, senderDomain) {
  const BATCH  = 3;    // 3 mails ek saath parallel
  const GAP    = 600;  // 600ms gap between batches
  const results = [];

  for (let i = 0; i < mails.length; i += BATCH) {
    const batch = mails.slice(i, i + BATCH).map(m => ({
      ...m,
      headers: { ...m.headers, 'Message-ID': makeMessageId(senderDomain) }
    }));

    const settled = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
    results.push(...settled);

    if (i + BATCH < mails.length) await delay(GAP);
  }
  return results;
}

// ─── /send ────────────────────────────────────────────────────────────────────
app.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    const senderName = xss(String(req.body.senderName || 'Team').trim()).slice(0, 100);
    const email      = String(req.body.email     || '').trim().toLowerCase();
    const password   = String(req.body.password  || '').trim();
    const subjectRaw = xss(String(req.body.subject  || 'Hello').trim()).slice(0, 998);
    const messageRaw = String(req.body.message   || '').trim().slice(0, 50000);
    const recipients = String(req.body.recipients || '');

    if (!isEmail(email))
      return res.json({ success: false, message: '❌ Invalid sender Gmail address' });
    if (!password)
      return res.json({ success: false, message: '❌ App Password required' });

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim().toLowerCase())
      .filter(r => isEmail(r));

    if (recipientList.length === 0)
      return res.json({ success: false, message: '❌ No valid recipient emails found' });
    if (recipientList.length > 500)
      return res.json({ success: false, message: '❌ Max 500 recipients allowed' });

    const senderDomain = email.split('@')[1] || 'gmail.com';
    const campaignId   = crypto.randomBytes(8).toString('hex');
    const safeName     = senderName.replace(/[<>"]/g, '');

    const { html, text, subject } = buildMail(messageRaw, subjectRaw);

    // Pooled transporter — fast parallel sending
    const transporter = nodemailer.createTransport({
      host      : 'smtp.gmail.com',
      port      : 587,
      secure    : false,
      requireTLS: true,
      auth      : { user: email, pass: password },
      tls       : { rejectUnauthorized: true },
      pool      : true,
      maxConnections: 3,
      maxMessages   : 100,
      socketTimeout : 15000
    });

    await transporter.verify();

    const mails = recipientList.map((to, idx) => ({
      from   : `"${safeName}" <${email}>`,
      to,
      subject,
      text,
      html,
      headers: {
        'Message-ID'            : makeMessageId(senderDomain),
        'List-Unsubscribe'      : `<mailto:${email}?subject=Unsubscribe>`,
        'List-Unsubscribe-Post' : 'List-Unsubscribe=One-Click',
        'Precedence'            : 'bulk',
        'X-Mailer'              : 'FastMailer/1.0',
        'X-Campaign-ID'         : campaignId,
        'X-Sequence'            : String(idx + 1)
      }
    }));

    const results = await sendFast(transporter, mails, senderDomain);
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
      msg = '❌ Gmail auth failed. Use App Password (not your Gmail password).';
    else if (/ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(err.message))
      msg = '❌ Cannot connect to Gmail SMTP. Check internet.';
    return res.json({ success: false, message: msg });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Fast Mailer → http://localhost:${PORT}`));
