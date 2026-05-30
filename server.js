require("dotenv").config();

const express = require("express");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send(`
    <h1>Mailer API Running 🚀</h1>
    <p>Server is working correctly.</p>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
