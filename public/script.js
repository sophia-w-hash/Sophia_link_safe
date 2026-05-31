document.getElementById("sendBtn")
.addEventListener("click", async () => {

const res = await fetch("/send",{
method:"POST"
});

const data = await res.json();

document.getElementById("statusMessage")
.innerText = data.message;

});

document.getElementById("logoutBtn")
.addEventListener("dblclick", async () => {

const res = await fetch("/logout",{
method:"POST"
});

const data = await res.json();

if(data.success){
window.location.href="/";
}

});
