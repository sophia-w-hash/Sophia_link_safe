import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* 🔐 SECURITY */
app.use(express.json({ limit: "40kb" }));
app.disable("x-powered-by");

/* 📁 STATIC */
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ⚖️ SAFE LIMIT SETTINGS */
const HOURLY_LIMIT = 26;
const PARALLEL = 2;
const DELAY_MS = 200;

let stats = {};
setInterval(() => {
  stats = {};
}, 60 * 60 * 1000);

/* 🧹 CLEAN INPUT */
const cleanText = t =>
  (t || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3000);

const cleanSubject = s =>
  (s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

const cleanName = n =>
  (n || "")
    .replace(/[<>"]/g, "")
    .trim()
    .slice(0, 50);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* 🚀 SAFE SENDING */
async function sendSafely(transporter, mails) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") sent++;
      else console.log("Send fail:", r.reason?.message);
    });

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return sent;
}

/* 📩 SEND API */
app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields ❌" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail ❌" });

  if (!stats[gmail]) stats[gmail] = { count: 0 };

  if (stats[gmail].count >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached ❌" });

  const recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  const remaining = HOURLY_LIMIT - stats[gmail].count;

  if (recipients.length === 0)
    return res.json({ success: false, msg: "No valid recipients ❌" });

  if (recipients.length > remaining)
    return res.json({ success: false, msg: "Limit full ❌" });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmail,
      pass: apppass
    }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Gmail login failed ❌" });
  }

  const safeName = cleanName(senderName) || gmail;

  /* ✅ FIXED MAIL BUILD */
  const mails = recipients.map(r => ({
    from: `"${safeName}" <${gmail}>`,
    to: r,
    subject: cleanSubject(subject),
    text: cleanText(message)
  }));

  const sent = await sendSafely(transporter, mails);

  stats[gmail].count += sent;

  return res.json({
    success: true,
    sent
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Ultra Safe Mail Server Running");
});
