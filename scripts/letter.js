const myURL = 'https://script.google.com/macros/s/AKfycbxExK7h0NB1qR5itDb57cW-3qgc3AWzoLmD8Gjcm0cyLPrnBZe6iGyPMnlY0n3FlUEPKA/exec';
let [codes, student, placement, pID, pDate, code50k, mylist, myletter] = [[],[],[],[],[],[], '', ''];

fetch(myURL)
	.then(res => {
		if(res.ok) {
			message.innerHTML = '';
			document.getElementsByClassName('group')[0].style.display = "flex";
		}
		return res.json()
	})
	.then(data => {
		mylist = data.appRegion;
		myletter = data.letter;
		for(i = 0; i < mylist.length; i++){
			codes[i] = mylist[i][0];
			student[i] = mylist[i][1];
			placement[i] = mylist[i][2];
			pID[i] = mylist[i][4];
			code50k[i] = mylist[i][5];
		}
	});