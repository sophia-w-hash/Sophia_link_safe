import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/send", async (req, res) => {
  try {
    const {
      senderName,
      gmail,
      appPassword,
      recipient,
      subject,
      message
    } = req.body;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: appPassword
      }
    });

    await transporter.verify();

    await transporter.sendMail({
      from: `"${senderName}" <${gmail}>`,
      to: recipient,
      subject,
      text: message
    });

    res.json({
      success: true,
      message: "Mail sent"
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
