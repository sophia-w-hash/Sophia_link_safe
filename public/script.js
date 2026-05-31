document.addEventListener("DOMContentLoaded", () => {

  if (!sessionStorage.getItem("auth")) {
    location.href = "/login.html";
    return;
  }

  let sending = false;

  const sendBtn = document.getElementById("sendBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  sendBtn.addEventListener("click", () => {
    if (!sending) sendMail();
  });

  logoutBtn.addEventListener("dblclick", () => {
    if (!sending) {
      sessionStorage.clear();
      location.href = "/login.html";
    }
  });

  async function sendMail() {
    sending = true;
    sendBtn.disabled = true;
    sendBtn.innerText = "Sending...";

    try {
      const res = await fetch("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderName: document.getElementById("senderName").value.trim(),
          gmail: document.getElementById("gmail").value.trim(),
          apppass: document.getElementById("apppass").value.trim(),
          subject: document.getElementById("subject").value.trim(),
          message: document.getElementById("message").value.trim(),
          to: document.getElementById("to").value.trim()
        })
      });

      const data = await res.json();

      if (!data.success) {
        alert(data.msg || "Sending failed ❌");
        return;
      }

      alert(`Send_1 ✅\nEmails Sent: ${data.sent}`);

    } catch {
      alert("Server error ❌");
    } finally {
      sending = false;
      sendBtn.disabled = false;
      sendBtn.innerText = "Send All";
    }
  }

});
