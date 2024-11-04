// selecting the elements from the DOM
let data = localStorage.getItem('products'),
    form = document.querySelector('form'),
    btnSubmit = document.querySelector('[type="submit"]'),
    btnCancel = document.querySelector('[type="button"]'),
    btnCommit = document.querySelector('#commit'),
    title = document.querySelector('#title'),
    qty = document.querySelector('#qty'),
    cp = document.querySelector('#cp'),
    //sp = document.querySelector('#sp'),
    sp = document.querySelectorAll('select')[1],
    inputs = form.querySelectorAll('input'),
    tbody = document.querySelector('tbody'),
    tfoot = document.querySelector('tfoot'),
    btnClearData = document.querySelector('#btnClearData'),
    dataCount = document.querySelector('#dataCount'),
    search = document.querySelector('#search'),
    pages = document.querySelector('#pages'),
    demo = document.getElementById('demo'),
    tr = document.querySelectorAll('tr'),
    newdata = [];

const modal = document.querySelector('[data-modal]');

const fetchdata = () => {
    fetch('https://script.google.com/macros/s/AKfycby_PT5APSRGbS8vPIy2hW8LvNrm2ocrtXAkX3JBsnE6yk4UK4xVlKcmT7clZ-tPO_GdpA/exec')
    .then(res => res.json())
    .then(mydata => {
        tfoot.innerHTML = '';
        tbody.innerHTML = '';
        // reinitialize/reset/update the value of data array
        //data = JSON.parse(localStorage.getItem('products'));
        
        data = mydata.appRegion;
        // Displaying the total number of products 
        //dataCount.textContent = data ? data.length : 0;
        // assert the data array is not empty
        if(data != null && data.length > 0){
            const len = 400 > data.length ? data.length : 400;
            // loop through the data array and display the data in the table :::<td>${data[i][2]}</td> for Adm.NO
            for(i=0;i<len;i++){ //this reading the first 20. To be changed to the first 100 later.
                tbody.innerHTML += `<tr>
                    <td>${data[i][0]}</td>
                    <td>${data[i][1].toUpperCase()}</td>
                    <td>${data[i][4]}</td>
                    <td>${data[i][5]}</td>
                    <td style="width: 115px;">
                        <button type="button" id="btnEditProduct" onclick="previewUpdate(${i+1});">+</button>
                        <button type="button" id="btnDeleteProduct" onclick="deleteProduct(${i+1});">-</button>
                    </td>
                </tr>`;
            }
        }
        else{
            // displaying to user that there is no data to show using the tfoot element
            tfoot.innerHTML = `<tr>
                        <td colspan="7"><h1 style="background: #f1f1f1; color: #f00; text-align: center; padding: 40px;">No data to show</h1></td>
                    </tr>
            `;
        }
        //fetchProducts();
    });
}

pages.addEventListener('change', e => {    
    tfoot.innerHTML = '';
    tbody.innerHTML = '';
                
    if(data != null && data.length > 0){
        const len = pages.value > data.length ? data.length : pages.value;
        // loop through the data array and display the data in the table :::<td>${data[i][2]}</td> for Adm.NO
        try {
            for(i=pages.value - 400;i<len;i++){ //this reading the first 20. To be changed to the first 100 later.
                tbody.innerHTML += `<tr>
                    <td>${data[i][0]}</td>
                    <td>${data[i][1].toUpperCase()}</td>
                    <td>${data[i][4]}</td>
                    <td>${data[i][5]}</td>
                    <td style="width: 115px;">
                        <button type="button" id="btnEditProduct" onclick="previewUpdate(${i+1});">+</button>
                        <button type="button" id="btnDeleteProduct" onclick="deleteProduct(${i+1});">-</button>
                    </td>
                </tr>`;
            }
        } catch (err) {
            err.name ? tbody.innerHTML = "<div class='tbd'>Empty page.</div>" : console.log('OK');
        }
    }
    else{
        // displaying to user that there is no data to show using the tfoot element
        tfoot.innerHTML = `<tr>
                    <td colspan="7"><h1 style="background: #f1f1f1; color: #f00; text-align: center; padding: 40px;">No data to show</h1></td>
                </tr>
        `;
    }
});

const saveProduct = () => {
    let tdCode = document.querySelectorAll('td:nth-child(1)')[0];
    let tdID = document.querySelectorAll('td:nth-child(2)')[0];
    let tdScore = document.querySelectorAll('td:nth-child(4)')[0];
    let tdStatus = document.querySelectorAll('td:nth-child(5)')[0];

    //data = data ?? [];
    //if(data.findIndex(product => product.title === title.value) < 0){
        // getting and storing the values of the form(user input) in the data array using the *SPREAD method
        //let newdata = [{ title: tdName.innerText, qty: tdID.innerText, cp: tdScore.innerText/*, sp: sp.value*/ }];
        //let newdata = [{ title: title.value, qty: qty.value, cp: cp.value, sp: sp.value }];
        // checking the *DATA-ID attribute of the submit button to see if it is set or not and calling the appropriate function
        //localStorage.setItem('products', JSON.stringify(newdata));
        // checking to see if 10 changes have been made
        if(newdata.length < 10){
            newdata = [...newdata, { title: tdCode.innerText, qty: qty.value, cp: cp.value, sp: sp.value }];
        } else {
            return alert('Please click on "Commit" to save your changes before you continue.');
        }
        //update the table data (td)
        tdID.innerText = qty.value;
        tdScore.innerText = cp.value;
        tdStatus.innerText = sp.value;
        // fetching the data(all products) upon saving
        //fetchProducts();
        // clearing the form
        resetForm();
    //} 
   /* else {
        alert('Product already exists');
        title.focus();
    }*/
},
previewUpdate = i => {
    // preview the data to be updated in the form :::title.value = data[i].title;
    //let tdName = document.querySelectorAll('td:nth-child(3)');
    let tdID = document.querySelectorAll('td:nth-child(1)');
    let tdNumb = document.querySelectorAll('td:nth-child(3)');
    let tdScore = document.querySelectorAll('td:nth-child(4)');

    //console.log("Before: " + i);
    i = (400+i)-pages.value;
    --i;
    //console.log("After: " + i);
    let myNumber = window.prompt(`Enter admission number: ${document.querySelectorAll('td:nth-child(2)')[i].textContent}`);

    if(myNumber){
        if(!(tdScore[i].textContent == '50,000' /*|| newdata.includes(tdID[i].textContent)*/)){
            newdata.push([tdID[i].textContent, myNumber]);
            tdScore[i].textContent = '50,000';
            tdNumb[i].textContent = myNumber;
        } else {
            tdScore[i].textContent = '50,000';
            tdNumb[i].textContent = myNumber;
        }
    }
        //--i;
        
},
updateProduct = id => {
    //console.log(id);
    let tdCode = document.querySelectorAll('td:nth-child(1)')[id];
    let tdID = document.querySelectorAll('td:nth-child(2)')[id];
    let tdScore = document.querySelectorAll('td:nth-child(4)')[id];
    let tdStatus = document.querySelectorAll('td:nth-child(5)')[id];
    // updating the values of the data array 
    /*data[id].title = title.value;
    data[id].qty = qty.value;
    data[id].cp = cp.value;
    data[id].sp = sp.value;*/
    //let upddata = [...[localStorage.products], [{ title: title.value, qty: qty.value, cp: cp.value, sp: sp.value }]];
    // update the localStorage
    //localStorage.setItem('products', upddata/*JSON.stringify(upddata)*/);
    // checking to see if 10 changes have been made
    if(newdata.length < 10){
        newdata = [...newdata, { title: tdCode.innerText, qty: qty.value, cp: cp.value, sp: sp.value }];
    } else {
        return alert('Please click on "Commit" to save your changes before you continue.');
    }
    // update the table data (td)
    tdID.innerText = qty.value;
    tdScore.innerText = cp.value;
    tdStatus.innerText = sp.value;
    // fetch the data again
    //fetchProducts();
    resetForm();
},
deleteProduct = i => {
    let tdID = document.querySelectorAll('td:nth-child(1)');
    let tdNumb = document.querySelectorAll('td:nth-child(3)');
    let tdScore = document.querySelectorAll('td:nth-child(4)');
    /*&& tdlast[i].lastElementChild.textContent == "-"*/

    i = (400+i)-pages.value;
    --i;
    //console.log(i);

    newdata.map(function(elem,ind,arr){
        if(elem[0] == tdID[i].textContent){
            arr.splice(ind,1);
        }
    });

    tdScore[i].textContent = '';
    tdNumb[i].textContent = '';

},
searchProducts = query => {
    // emptying the contents of the tfoot element before displaying search results
    tfoot.innerHTML = '';
    // looping through the data array and returning the data that matches the query by using the *INCLUDES method and toggling the display property of the tr elements
    let found = data.map((item, i) => tbody.querySelectorAll('tr')[i].style.display = item.title.toLowerCase().includes(query.toLowerCase()) ? '' : 'none');
    // displaying no data to show if the query is not found by using the *FILTER method of the data array
    if(data.length === found.filter(tr => tr == 'none').length){
        // setting the contents of the tfoot element
        tfoot.innerHTML = `<tr>
                            <td colspan="7"><h1 style="background: #f1f1f1; color: #f00; text-align: center; padding: 40px;">No results found!</h1></td>
                        </tr>`;
    }
},
clearData = () => {
    if(data && confirm('Are you sure you want to clear all data?')){
        // clearing the localStorage
        localStorage.removeItem('products');
        // fetching the data again
        fetchProducts();
    }
};

fetchdata();

form.addEventListener('submit', e => {
    // preventing the default behaviour of the form
    e.preventDefault();
    // saving the data to the localStorage
    !parseInt(btnSubmit.getAttribute('data-id')) ? saveProduct() : updateProduct(btnSubmit.getAttribute('data-id')); 
});

// searching the data when the user types in the search input
//search.addEventListener('input', e => searchProducts(e.target.value));

// cancel update and reset the form to its default state
//btnCancel.addEventListener('click', e => resetForm());

// save changes to server
btnCommit.addEventListener('click', e => {
    demo.firstChild.innerText = 'Saving data...';
    demo.style.zIndex = '10';
    demo.style.display = 'flex';
    fetch('https://script.google.com/macros/s/AKfycbw_hNT5M7739y2UQpz0kw9GUW_1dj2tJKcTCQ4HKdEE6aOwClQIzZC_Pf_ykGG89YmT/exec',{
        method:'POST',
        body:JSON.stringify(newdata),
        mode:'no-cors'
    })
        .then(res => {
            if(res.text()){
                //console.log('Promise fulfilled.');
                demo.style.display = 'none';
                newdata = [];
                fetchdata();
            }
        })    
})

// clearing the data from the localStorage
//btnClearData.addEventListener('click', e => clearData());
