function logout() {
  fetch('/logout', { method: 'POST' })
    .then(() => window.location.href = '/');
}

document.getElementById('sendBtn')?.addEventListener('click', () => {
  const senderName = document.getElementById('senderName').value;
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('pass').value.trim();
  const subject = document.getElementById('subject').value;
  const message = document.getElementById('message').value;
  const recipients = document.getElementById('recipients').value.trim();
  const status = document.getElementById('statusMessage');

  if (!email || !password || !recipients) {
    status.innerText = '❌ Email, password and recipients required';
    alert('❌ Email, password and recipients required');
    return;
  }

  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  btn.innerText = '⏳ Sending...';

  fetch('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, email, password, subject, message, recipients })
  })
    .then(r => r.json())
    .then(data => {
      status.innerText = data.message;

      if (data.success) {
        alert('✅ Mail sent successfully!');
      } else {
        alert('❌ Failed: ' + data.message);
      }

      btn.disabled = false;
      btn.innerText = 'Send All';
    })
    .catch(err => {
      status.innerText = '❌ Error: ' + err.message;
      alert('❌ Error: ' + err.message);
      btn.disabled = false;
      btn.innerText = 'Send All';
    });
});
