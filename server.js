const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

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

function auth(req, res, next) {
  if (req.session.loggedIn) return next();
  return res.redirect("/");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }

  res.json({
    success: false,
    message: "Invalid Login"
  });
});

app.get("/launcher", auth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      success: true,
      message: "Logged out"
    });
  });
});

app.post("/send", auth, (req, res) => {
  res.json({
    success: true,
    message: "Demo UI Only"
  });
});

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
