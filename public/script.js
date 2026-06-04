const recipientsEl = document.getElementById('recipients');
const countEl = document.getElementById('recipientCount');

if (recipientsEl) {
  recipientsEl.addEventListener('input', () => {
    const emails = parseRecipients(recipientsEl.value);
    countEl.textContent = emails.length + ' recipients';
  });
}

function parseRecipients(val) {
  return val.split(/[\n,]+/).map(e => e.trim()).filter(e => e.includes('@'));
}

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  fetch('/logout', { method: 'POST' }).then(() => window.location.href = '/');
});

document.getElementById('sendBtn')?.addEventListener('click', () => {
  const senderName = document.getElementById('senderName').value.trim();
  const email      = document.getElementById('email').value.trim();
  const password   = document.getElementById('pass').value.trim();
  const subject    = document.getElementById('subject').value.trim();
  const message    = document.getElementById('message').value.trim();
  const recipients = document.getElementById('recipients').value.trim();
  const status     = document.getElementById('statusMessage');
  const btn        = document.getElementById('sendBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar  = document.getElementById('progressBar');

  if (!email || !password || !subject || !message || !recipients) {
    status.style.color = '#ef4444';
    status.innerText = '❌ Sab fields fill karo.';
    return;
  }

  const recipientList = parseRecipients(recipients);
  if (recipientList.length === 0) {
    status.style.color = '#ef4444';
    status.innerText = '❌ Koi valid email nahi mili.';
    return;
  }

  if (recipientList.length > 500) {
    status.style.color = '#ef4444';
    status.innerText = '❌ Max 500 recipients allowed.';
    return;
  }

  btn.disabled = true;
  btn.innerText = '⏳ Sending...';
  status.style.color = '#3b82f6';
  status.innerText = `⏳ ${recipientList.length} emails bhej rahe hain...`;
  progressWrap.style.display = 'block';

  let prog = 10;
  progressBar.style.width = prog + '%';
  const progInterval = setInterval(() => {
    if (prog < 85) { prog += 5; progressBar.style.width = prog + '%'; }
  }, 600);

  fetch('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, email, password, subject, message, recipients })
  })
    .then(r => r.json())
    .then(data => {
      clearInterval(progInterval);
      progressBar.style.width = '100%';
      setTimeout(() => { progressWrap.style.display = 'none'; progressBar.style.width = '0%'; }, 800);
      if (data.success) {
        status.style.color = '#16a34a';
        status.innerText = data.message;
      } else {
        status.style.color = '#ef4444';
        status.innerText = data.message;
      }
      btn.disabled = false;
      btn.innerText = '🚀 Send All';
    })
    .catch(err => {
      clearInterval(progInterval);
      progressWrap.style.display = 'none';
      status.style.color = '#ef4444';
      status.innerText = '❌ Server error: ' + err.message;
      btn.disabled = false;
      btn.innerText = '🚀 Send All';
    });
});
