const router = require("express").Router();
const controller = require("../controllers/emailController");

router.post("/send", controller.send);

module.exports = router;
