require("dotenv").config();

const express = require("express");
const emailRoutes = require("./routes/emailRoutes");

const app = express();

app.use(express.json());

app.use("/api/email", emailRoutes);

app.listen(process.env.PORT, () => {
  console.log(`Server running on ${process.env.PORT}`);
});
