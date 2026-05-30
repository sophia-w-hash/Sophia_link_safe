require("dotenv").config();

const express = require("express");
const emailRoutes = require("./routes/emailRoutes");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Mailer API Running 🚀");
});

app.use("/api/email", emailRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
