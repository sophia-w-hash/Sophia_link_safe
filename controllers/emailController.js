const { sendEmail } = require("../services/emailService");

exports.send = async (req, res) => {
  try {
    const { to, subject, html } = req.body;

    await sendEmail(to, subject, html);

    res.json({
      success: true,
      message: "Email sent successfully"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
