// script.js

function logout() {
  fetch('/logout', { method: 'POST' })
    .then(() => window.location.href = '/');
}

// Live recipient counter
const rcEl    = document.getElementById('recipients');
const rcCount = document.getElementById('rcCount');

if (rcEl && rcCount) {
  rcEl.addEventListener('input', () => {
    const count = rcEl.value
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r))
      .length;
    rcCount.innerText = count + ' recipient' + (count !== 1 ? 's' : '');
    rcCount.style.color = count > 500 ? '#ef4444' : '#10b981';
  });
}

document.getElementById('sendBtn')?.addEventListener('click', () => {
  const senderName = document.getElementById('senderName').value.trim();
  const email      = document.getElementById('email').value.trim();
  const password   = document.getElementById('pass').value.trim();
  const subject    = document.getElementById('subject').value.trim();
  const message    = document.getElementById('message').value.trim();
  const recipients = document.getElementById('recipients').value.trim();
  const status     = document.getElementById('statusMessage');
  const btn        = document.getElementById('sendBtn');

  // Basic client-side validation
  if (!email || !password || !recipients) {
    status.innerText      = '❌ Gmail, App Password and Recipients are required';
    status.style.color    = '#ef4444';
    return;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRe.test(email)) {
    status.innerText   = '❌ Enter a valid Gmail address';
    status.style.color = '#ef4444';
    return;
  }

  const count = recipients
    .split(/[\n,]+/)
    .map(r => r.trim())
    .filter(r => emailRe.test(r))
    .length;

  if (count === 0) {
    status.innerText   = '❌ No valid recipient emails found';
    status.style.color = '#ef4444';
    return;
  }

  if (count > 500) {
    status.innerText   = '❌ Max 500 recipients allowed';
    status.style.color = '#ef4444';
    return;
  }

  if (!confirm(`Send email to ${count} recipient(s)?`)) return;

  btn.disabled     = true;
  btn.innerText    = '⏳ Sending...';
  status.innerText = '';

  fetch('/send', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ senderName, email, password, subject, message, recipients })
  })
  .then(r => r.json())
  .then(data => {
    status.innerText   = data.message;
    status.style.color = data.success ? '#10b981' : '#ef4444';
    btn.disabled  = false;
    btn.innerText = '🚀 Send All';
  })
  .catch(err => {
    status.innerText   = '❌ Network error: ' + err.message;
    status.style.color = '#ef4444';
    btn.disabled  = false;
    btn.innerText = '🚀 Send All';
  });
});
