const transporter = require("../config/mailer");

async function sendEmail(to, subject, html) {
  return transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    html
  });
}

module.exports = { sendEmail };
