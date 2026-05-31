"use strict";

const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const LOGIN_KEY = "^%%^&^&%$$#$$%#P#@";

const SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const SESSION_TIME = 60 * 60 * 1000;

/* SAME SPEED */
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

/* SAME LIMITS */
const DAILY_LIMIT = 120;
const HOURLY_LIMIT = 40;

/* ================= BASIC ================= */

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: SESSION_TIME
    }
  })
);

/* ================= SECURITY ================= */

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= HELPERS ================= */

const delay = ms => new Promise(r => setTimeout(r, ms));
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str = "", max = 120) {
  return str.replace(/[\r\n]/g, "").trim().slice(0, max);
}

function normalize(str = "", max = 20000) {
  return str.replace(/\r\n/g, "\n").slice(0, max);
}

/* ================= LIMIT ================= */

const dailyMap = new Map();
const hourlyMap = new Map();

function checkLimits(sender, count) {
  const now = Date.now();

  const d = dailyMap.get(sender) || { count: 0, start: now };
  if (now - d.start > 86400000) {
    d.count = 0;
    d.start = now;
  }

  const h = hourlyMap.get(sender) || { count: 0, start: now };
  if (now - h.start > 3600000) {
    h.count = 0;
    h.start = now;
  }

  if (d.count + count > DAILY_LIMIT) return "daily_limit";
  if (h.count + count > HOURLY_LIMIT) return "hourly_limit";

  d.count += count;
  h.count += count;

  dailyMap.set(sender, d);
  hourlyMap.set(sender, h);

  return true;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === LOGIN_KEY) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === LOGIN_KEY && password === LOGIN_KEY) {
    req.session.regenerate(() => {
      req.session.user = LOGIN_KEY;
      res.json({ success: true });
    });
  } else {
    res.json({ success: false });
  }
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure.sid");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!email || !password || !recipients)
      return res.json({ success: false });

    if (!emailRegex.test(email))
      return res.json({ success: false });

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(r => emailRegex.test(r))
      )
    ];

    if (!list.length)
      return res.json({ success: false });

    const limit = checkLimits(email, list.length);
    if (limit !== true)
      return res.json({ success: false, message: limit });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: email,
        pass: password
      }
    });

    await transporter.verify();

    const finalName = clean(senderName || email);
    const finalSubject = clean(subject || "Message");
    const finalText = normalize(message || "");

    let sent = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(to =>
          transporter.sendMail({
            from: `"${finalName}" <${email}>`,
            to,
            subject: finalSubject,
            text: finalText,
            html: `<p>${finalText.replace(/\n/g, "<br>")}</p>`,

            headers: {
              "X-Mailer": "NodeMailer",
              "List-Unsubscribe": "<mailto:unsubscribe@" + email.split("@")[1] + ">"
            }
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled") sent++;
      });

      await delay(BATCH_DELAY);
    }

    res.json({ success: true, message: `Sent ${sent}` });

  } catch {
    res.json({ success: false });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("🚀 Safe Mail Server running on port " + PORT);
});
