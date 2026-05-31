const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "change-this-secret",
    resave: false,
    saveUninitialized: false
  })
);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "admin") {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }

  res.json({
    success: false,
    message: "Invalid credentials"
  });
});

app.get("/launcher", (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/");
  }

  res.sendFile(path.join(__dirname, "public", "launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      success: true,
      message: "Logged out"
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
