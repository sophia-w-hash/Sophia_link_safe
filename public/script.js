if (!localStorage.getItem("auth")) {
  location.href = "/login.html";
}

document
  .getElementById("logoutBtn")
  .addEventListener("dblclick", () => {
    localStorage.removeItem("auth");
    location.href = "/login.html";
  });

document
  .getElementById("sendBtn")
  .addEventListener("click", sendMail);

async function sendMail() {

  const btn =
    document.getElementById("sendBtn");

  btn.disabled = true;
  btn.innerText = "Sending...";

  try {

    const response = await fetch("/send", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        senderName:
          document.getElementById("senderName").value,

        gmail:
          document.getElementById("gmail").value,

        appPassword:
          document.getElementById("appPassword").value,

        recipient:
          document.getElementById("recipient").value,

        subject:
          document.getElementById("subject").value,

        message:
          document.getElementById("message").value
      })
    });

    const data = await response.json();

    alert(data.message);

  } catch {

    alert("Error");

  }

  btn.disabled = false;
  btn.innerText = "Send";
}
