import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js"

const appSettings = {
    databaseURL: "https://dcauf-488e6-default-rtdb.europe-west1.firebasedatabase.app/"
}

const app = initializeApp(appSettings)
const database = getDatabase(app)
const namesInDB = ref(database, "names")


onValue(namesInDB, function(snapshot) {
    //let booksArray = Object.values(snapshot.val())
    
    clearBooksListEl()
    
    // Challenge: Write a for loop where you console log each book.
    for (let i = 0; i < booksArray.length; i++) {
        let currentBook = booksArray[i]
        
        // Challenge: Use the appendBookToBooksListEl() function to append book instead of console logging
        appendBookToBooksListEl(currentBook)
    }
})

function appendBookToBooksListEl() {
    dataRef.once('value', function(snapshot) {
        var dataBody = document.getElementById('dataBody');
        dataBody.innerHTML = ''; // Clear existing data

        var counter = 1;
        snapshot.forEach(function(childSnapshot) {
            var data = childSnapshot.val();
            var row = `<tr>
                <td>${counter}</td>
                <td>${data.name}</td>
                <td>${data.gender}</td>
                <td>${data.email}</td>
                <td>${data.phone}</td>
            </tr>`;
            dataBody.innerHTML += row;
            counter++;
        });
    });
}
console.log(appendBookToBooksListEl())