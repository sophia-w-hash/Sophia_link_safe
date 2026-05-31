"use strict";

const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 8080;

/* ================= CONFIG ================= */

const ADMIN_LOGIN = "#";

const SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const SESSION_TIME = 60 * 60 * 1000;

const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

const DAILY_LIMIT = 500;

/* ================= EXPRESS ================= */

app.disable("x-powered-by");

app.use(express.json({ limit: "25kb" }));
app.use(express.urlencoded({ extended: false, limit: "25kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      maxAge: SESSION_TIME
    }
  })
);

/* ================= SECURITY HEADERS ================= */

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= RATE LIMIT ================= */

const ipLimiter = new Map();

app.use((req, res, next) => {

  const ip = req.ip;
  const now = Date.now();
  const record = ipLimiter.get(ip);

  if (!record || now - record.start > 60000) {
    ipLimiter.set(ip, { count: 1, start: now });
    return next();
  }

  if (record.count > 100) {
    return res.status(429).send("Too many requests");
  }

  record.count++;

  next();
});

/* ================= HELPERS ================= */

const delay = ms => new Promise(r => setTimeout(r, ms));

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanHeader(text = "", max = 120) {
  return text.replace(/[\r\n]/g, "").trim().slice(0, max);
}

function preserveText(text = "", max = 20000) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").slice(0, max);
}

/* ================= DAILY LIMIT ================= */

const dailyCounter = new Map();

function checkDailyLimit(sender, amount) {

  const now = Date.now();
  const record = dailyCounter.get(sender);

  if (!record || now - record.start > 86400000) {
    dailyCounter.set(sender, { count: 0, start: now });
  }

  const updated = dailyCounter.get(sender);

  if (updated.count + amount > DAILY_LIMIT) {
    return false;
  }

  updated.count += amount;

  return true;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {

  if (req.session.user === ADMIN_LOGIN) return next();

  res.redirect("/");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {

  const { username, password } = req.body || {};

  if (username === ADMIN_LOGIN && password === ADMIN_LOGIN) {

    req.session.user = ADMIN_LOGIN;

    return res.json({ success: true });
  }

  res.json({ success: false });
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

/* ================= SEND MAIL ================= */

app.post("/send", requireAuth, async (req, res) => {

  try {

    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!email || !password || !recipients) {

      return res.json({ success: false, message: "Missing fields" });

    }

    if (!emailRegex.test(email)) {

      return res.json({ success: false, message: "Invalid email" });

    }

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(r => emailRegex.test(r))
      )
    ];

    if (!list.length) {

      return res.json({ success: false, message: "No recipients" });

    }

    if (!checkDailyLimit(email, list.length)) {

      return res.json({ success: false, message: "Daily limit reached" });

    }

    const transporter = nodemailer.createTransport({

      service: "gmail",

      auth: {

        user: email,

        pass: password

      }

    });

    await transporter.verify();

    const finalName = cleanHeader(senderName || email);
    const finalSubject = cleanHeader(subject || "Message");
    const finalText = preserveText(message || "");

    let sent = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {

      const batch = list.slice(i, i + BATCH_SIZE);

      const result = await Promise.allSettled(

        batch.map(to =>
          transporter.sendMail({

            from: `"${finalName}" <${email}>`,

            to,

            subject: finalSubject,

            text: finalText

          })
        )
      );

      result.forEach(r => {

        if (r.status === "fulfilled") sent++;

      });

      await delay(BATCH_DELAY);

    }

    res.json({

      success: true,

      message: `Send ${sent}`

    });

  } catch (err) {

    res.json({

      success: false,

      message: "Sending failed"

    });

  }

});

/* ================= START ================= */

app.listen(PORT, () => {

  console.log("Server running on port " + PORT);

});
