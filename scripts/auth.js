//const url = 'https://script.google.com/macros/s/AKfycbxRezcr97IadatFxwj6iRSfLB68ihvge3wpor5MlCiJTeJFMeJjKl7a9zWpSi__Nfgz/exec';
var laClef = [];     //arr for auth name
const authware = {
	1: "Emmanuel Onuh",
	2: "Beatrice Ogwubo",
	3: "Ihotu Essien",
	4: "Joseph Nnamdi"
}
function myData() {
    fetch(url)
        .then(res => res.json())
        .then(data => {
            for(i = 0; i < data.length; i++) {
				laClef[i] = data[i][5];
            }
		laClef.shift();
        });
}

myData();
//create a delay timer to allow for the loading of data