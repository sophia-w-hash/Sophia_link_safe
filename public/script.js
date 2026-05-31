async function login() {
  const res = await fetch("/login", {
    method: "POST"
  });

  const data = await res.json();

  if (data.success) {
    window.location.href = "/launcher";
  }
}
