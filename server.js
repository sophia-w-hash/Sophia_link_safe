"use strict";

const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 8080;

const LOGIN_KEY = "@#";

app.disable("x-powered-by");

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (req.session.user === LOGIN_KEY) return next();
  return res.status(401).json({ success: false });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === LOGIN_KEY && password === LOGIN_KEY) {
    req.session.user = LOGIN_KEY;
    return res.json({ success: true });
  }

  return res.json({ success: false });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* transactional email endpoint */
app.post("/send", requireAuth, async (req, res) => {
  try {
    const { smtpEmail, smtpPassword, recipient, subject, message } =
      req.body || {};

    if (
      !smtpEmail ||
      !smtpPassword ||
      !recipient ||
      !subject ||
      !message
    ) {
      return res.json({
        success: false,
        message: "Missing fields"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpEmail,
        pass: smtpPassword
      }
    });

    await transporter.sendMail({
      from: smtpEmail,
      to: recipient,
      subject,
      text: message
    });

    return res.json({
      success: true,
      message: "Email sent"
    });
  } catch {
    return res.json({
      success: false,
      message: "Send failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
