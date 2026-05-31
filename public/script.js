async function sendMail() {

  const payload = {
    smtpEmail: document.getElementById("smtpEmail").value,
    smtpPassword: document.getElementById("smtpPassword").value,
    recipient: document.getElementById("recipient").value,
    subject: document.getElementById("subject").value,
    message: document.getElementById("message").value
  };

  const r = await fetch("/send", {
    method: "POST",
    headers: {
      "Content-Type":"application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await r.json();

  document.getElementById("status").innerText =
    data.message;
}

async function logout() {

  await fetch("/logout", {
    method:"POST"
  });

  location.href="/";
}
