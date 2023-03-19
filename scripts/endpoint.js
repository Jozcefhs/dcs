const url = 'https://script.google.com/macros/s/AKfycbxRezcr97IadatFxwj6iRSfLB68ihvge3wpor5MlCiJTeJFMeJjKl7a9zWpSi__Nfgz/exec';

var myArr; //email
var myArr2; //code
var myArr3; //full name

var myArr3 = [];     //arr for full name
var myArr2 = [];    //arr for code
var myArr = [];    //arr for email
var myArr4 = [];    //arr for admission stat
function myData() {
    fetch(url)
        .then(res => res.json())
        .then(data => {
            //var myArr = [];
            for(i = 0; i < data.length; i++) {
                myArr3[i] = data[i][1];
                myArr[i] = data[i][2];
                myArr2[i] = data[i][0];
                myArr4[i] = data[i][3];
            }
        });
}

myData();
//create a delay timer to allow for the loading of data