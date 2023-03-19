// Deployment ID
// AKfycbw_IgmsXVi7dUfFBXbINo1efvfYJjQp0IhKpxrwPGw0JlxBnrnJJV6P_ejVq0LOIUAKkw

// URL
// https://script.google.com/macros/s/AKfycbw_IgmsXVi7dUfFBXbINo1efvfYJjQp0IhKpxrwPGw0JlxBnrnJJV6P_ejVq0LOIUAKkw/exec

const verified = document.getElementById('verified');
const input = document.querySelector('input[type=email]');
var inputDitto = document.getElementById('myInput');
const divInput = document.getElementById('input');
const btn = document.getElementById('btn');
const timesX = document.getElementById('times');
const infoAfter = window.getComputedStyle(divInput, '::after');
var duplicate = [];

inputDitto.addEventListener('keypress', function(event){
    if(event.key === "Enter"){
        event.preventDefault();
        btn.click();
    }
});

btn.onclick = () => { 
    if(input.type == 'email'){
        verifyEmail();
    } else {
        for(dupIndx in duplicate){
            if(input.value == myArr2[duplicate[dupIndx]]){
                verifyAdmission();
            } else {
                jsWarning();
            }
        }
    }   
}

function verifyAdmission(){
	let y = myArr2.indexOf(input.value, 1);
	switch (myArr4[y]){
		default:
			document.getElementsByClassName("title")[0].innerText = "Pending.";
			document.getElementsByClassName("description")[0].innerText = `${myArr3[y]}, your admission is still being processed. Please do kindly hold on.`;
			break;
		case 'Granted':
			document.getElementsByClassName("title")[0].innerText = "Success!";
			document.getElementsByClassName("description")[0].innerText = `${myArr3[y]}, you've been granted admission into Destiny Christian Academy. We wish you a hearty congratulation and hope that you will take us on our offer.`;
			break;
		case 'Denied':
			document.getElementsByClassName("title")[0].innerText = "Denied.";
			document.getElementsByClassName("description")[0].innerText = `${myArr3[y]}, we regret to announce to you that your application has not been taken. Wish you better luck next time.`;
			break;
	}
	document.getElementsByClassName("popup")[0].classList.add("active");
}

document.getElementById("dismiss").addEventListener('click', function(){
	//document.getElementsByClassName("popup")[0].classList.remove("active");
	location.href = "index.html";
});

function verifyEmail() {
    myArr.forEach(function(currVal, ind){
        if(input.value == currVal){
            duplicate.push(ind);
        }
    });

    if(myArr.includes(input.value, 1)) {
        verified.innerHTML = input.value;
        verified.style.display = 'block';
        input.value = "";
        input.setAttribute('type','text');
        input.setAttribute('placeholder', 'Enter your code');
        btn.textContent = "Login";
        timesX.style.display = 'inline';
    } else {
        jsWarning(input.type);
    }
}

function jsWarning (e) {
        if(e == 'email') {
            divInput.style.setProperty('--contentText', "'EMAIL could not be found.'");
        } else {
            divInput.style.setProperty('--contentText', "'CODE could not be found.'");
        }

        divInput.style.setProperty('--afterDisplay', 'inline');
        divInput.style.setProperty('--beforeDisplay', 'inline');
        
        setTimeout(() => {
            divInput.style.setProperty('--beforeDisplay', 'none');
            divInput.style.setProperty('--afterDisplay', 'none');
        }, 3000);
}

timesX.onclick = () => {
    input.value = "";
    document.querySelectorAll('.email').forEach(elem => {
        elem.getAttribute('id') == 'verified' ? elem.innerText = '' : elem.style.display = 'none';
    });
    input.setAttribute('type','email');
    input.setAttribute('placeholder', 'Enter your email');
    
    btn.textContent = "Submit";
}
