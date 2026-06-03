// server.js — Brevo SMTP Edition (Max Inbox)
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
// .env file mein ye sab likho:
//   LOGIN_USER=apna_username
//   LOGIN_PASS=apna_password
//   SESSION_SECRET=koi_lamba_random_string
//   BREVO_USER=brevo_pe_register_email
//   BREVO_PASS=brevo_smtp_password
//   SENDER_EMAIL=jis_email_se_mail_jayegi  (brevo verified email)
//   SENDER_NAME=Apna Naam
const ADMIN_USER   = process.env.LOGIN_USER    || '1';
const ADMIN_PASS   = process.env.LOGIN_PASS    || '1';
const SES_SECRET   = process.env.SESSION_SECRET || 'ch@nge-this-now!';
const BREVO_USER   = process.env.BREVO_USER    || '';
const BREVO_PASS   = process.env.BREVO_PASS    || '';
const SENDER_EMAIL = process.env.SENDER_EMAIL  || '';
const SENDER_NAME  = process.env.SENDER_NAME   || 'Team';

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

// ── One by one sender ────────────────────────────────────────────────────────
async function sendOneByOne(transporter, mails) {
  const results = [];
  for (let i = 0; i < mails.length; i++) {
    const result = await Promise.allSettled([transporter.sendMail(mails[i])]);
    results.push(result[0]);
    if (i < mails.length - 1) await delay(randDelay());
  }
  return results;
}

// ── /send ────────────────────────────────────────────────────────────────────
app.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    // Brevo credentials check
    if (!BREVO_USER || !BREVO_PASS || !SENDER_EMAIL) {
      return res.json({
        success: false,
        message: '❌ Brevo SMTP not configured. Check .env file.'
      });
    }

    const subject    = xss(String(req.body.subject   || '').trim()).slice(0, 998);
    const message    = String(req.body.message    || '').trim().slice(0, 50000);
    const recipients = String(req.body.recipients || '');

    if (!subject)
      return res.json({ success: false, message: '❌ Subject required' });
    if (!message)
      return res.json({ success: false, message: '❌ Message body required' });

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim().toLowerCase())
      .filter(r => isEmail(r));

    if (recipientList.length === 0)
      return res.json({ success: false, message: '❌ No valid recipient emails found' });
    if (recipientList.length > 500)
      return res.json({ success: false, message: '❌ Max 500 recipients allowed' });

    // ✅ Brevo SMTP transporter
    const transporter = nodemailer.createTransport({
      host      : 'smtp-relay.brevo.com',
      port      : 587,
      secure    : false,
      requireTLS: true,
      auth      : {
        user: BREVO_USER,
        pass: BREVO_PASS
      },
      tls          : { rejectUnauthorized: true },
      socketTimeout: 20000
    });

    await transporter.verify();

    const senderDomain = SENDER_EMAIL.split('@')[1] || 'gmail.com';

    // Pure plain text mails — no HTML, no links
    const mails = recipientList.map(to => ({
      from     : `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
      replyTo  : SENDER_EMAIL,
      to,
      subject,
      text     : message,
      messageId: makeId(senderDomain)
    }));

    const results = await sendOneByOne(transporter, mails);
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
      msg = '❌ Brevo auth failed. Check BREVO_USER and BREVO_PASS in .env';
    else if (/ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(err.message))
      msg = '❌ Cannot connect to Brevo SMTP. Check internet.';
    return res.json({ success: false, message: msg });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Fast Mailer → http://localhost:${PORT}`));
