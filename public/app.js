async function sendMail(){

    const status = document.getElementById("status");

    status.innerText = "Sending...";

    try{

        const response = await fetch("/api/email/send",{
            method:"POST",
            headers:{
                "Content-Type":"application/json"
            },
            body:JSON.stringify({
                senderName:document.getElementById("senderName").value,
                gmail:document.getElementById("gmail").value,
                appPassword:document.getElementById("appPassword").value,
                subject:document.getElementById("subject").value,
                message:document.getElementById("message").value,
                recipient:document.getElementById("recipient").value
            })
        });

        const data = await response.json();

        status.innerText =
            data.message || "Done";

    }catch(err){

        status.innerText = "Error";

    }
}
