

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"
import { getDatabase, ref, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js"


const appSettings = {
    apiKey: "AIzaSyADjWVvbiMY6bUhejWI7sw2YRh02JAXt7M",
    authDomain: "dcauf-488e6.firebaseapp.com",
    databaseURL: "https://dcauf-488e6-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "dcauf-488e6",
    storageBucket: "dcauf-488e6.appspot.com",
    messagingSenderId: "441347934350",
    appId: "1:441347934350:web:1835edd61ce0ea96b1e1df"
}


const app = initializeApp(appSettings)
const database = getDatabase(app)
const namesInDB = ref(database, "names")


console.log(app)


const form = document.querySelector('form')

form.addEventListener('submit', function(e)  {
    e.preventDefault()
    const fd = new FormData(form)
    const obj = Object.fromEntries(fd)
    console.log(obj)
     push(namesInDB, obj)
})

console.log(app)