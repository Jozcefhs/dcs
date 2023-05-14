const url = "https://script.google.com/macros/s/AKfycbxRezcr97IadatFxwj6iRSfLB68ihvge3wpor5MlCiJTeJFMeJjKl7a9zWpSi__Nfgz/exec";

let [codes, emails, fullnames, viewed] = [[], [], [], []];
var dots = document.querySelectorAll('.message i');
let id = setInterval(mydots, 1000);
let looper = 0;

function mydots() {
	if (looper > 2) {
		clearInterval(id);
		message.innerHTML = '';
	} else {
		dots[looper].style.transform = "scale(1)";
		looper++;
	}
}

fetch(url,
	{
		/*method: 'GET',
		mode: 'no-cors'*/
	}
)
	.then(res => {		
		if(res.ok) {
			message.innerHTML = '';
			document.getElementsByClassName('group')[0].style.display = "flex";
		}
		return res.json()
	})
	.then(data => {
		for (i = 0; i < data.length; i++) {
			if(data[i][2] != ""){
				codes[i] = data[i][0];
				fullnames[i] = data[i][1];
				emails[i] = data[i][2];
				viewed[i] = data[i][3];
			}
		}
	});