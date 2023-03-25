const url = 'https://script.google.com/macros/s/AKfycbxRezcr97IadatFxwj6iRSfLB68ihvge3wpor5MlCiJTeJFMeJjKl7a9zWpSi__Nfgz/exec';
//const search = document.querySelector('input[type=search]');
const submit = document.querySelector('input[type=submit]');
const userCardTemplate = document.querySelector('[data-user-template]');
const userCardContainer = document.querySelector('[data-user-cards-container]');
const searchInput = document.querySelector('[data-search]');

let users = [];

searchInput.addEventListener('input', (e) => {
	const value = e.target.value.toLowerCase();
	users.forEach(user => {
		const isVisible = user.name.toLowerCase().includes(value) || user.email.toLowerCase().includes(value);
		user.element.classList.toggle('hide', !isVisible);
	})
})

/*search.addEventListener('focus', function(){
	if(this.value == 'Enter a name'){
		this.value = '';
	} 
});
search.addEventListener('blur', function(){
	if(this.value == ''){
		this.value = 'Enter a name';
	} 
});*/

fetch(url)
	.then(res => res.json())
	.then(data => {
		/*data.forEach(function(user, stat){
			const card = userCardTemplate.content.cloneNode(true).children[0];
			const header = card.querySelector('[data-header]');
			const body = card.querySelector('[data-body]');
			
			header.textContent = user[1];
			body.textContent = user[3];
			
			userCardContainer.append(card);
			//user[1] == undefined ? undefined : console.log(user[1]);
			//console.log(user[1]);
		});*/
		//users = data.map(function(){
			const emptyCells = [];
			
			for(i = 6; i < data.length; i++){ /* 6 because it ignores the first 5 items in the array*/
				const card = userCardTemplate.content.cloneNode(true).children[0];
				const header = card.querySelector('[data-header]');
				const body = card.querySelector('[data-body]');
				
				const date = body.querySelector('.date');
				const email = body.querySelector('.email');
				const email_status = body.querySelector('.email-status');
				
				if(!(data[i][1] == '')){
					header.textContent = data[i][1];
					date.textContent = data[i][4];
					email.textContent = data[i][2];
					email_status.textContent = data[i][7];
					userCardContainer.append(card);
					users.push({ name: data[i][1], email: data[i][2], element: card });
				} else {
					emptyCells.push(data[i][1]);
				}
			}
			document.querySelector('[data-record]').innerText += data.length - (emptyCells.length + 6);
		//})
	})
/*fetch(url)
	.then(res => res.json())
	.then(data => {
		data.forEach(user => {
			console.log(user[7]);
		});
	})*/