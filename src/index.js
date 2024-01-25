import { initializeApp } from 'firebase/app'
import {
    getFirestore, collection, getDocs
} from 'firebase/firestore'

const firebaseConfig = {
    apiKey: "AIzaSyCT92x3HE8nUsYsKgQ2eJZU7DHQ83mTgwE",
    authDomain: "dca-mobile-26810.firebaseapp.com",
    projectId: "dca-mobile-26810",
    storageBucket: "dca-mobile-26810.appspot.com",
    messagingSenderId: "843119620986",
    appId: "1:843119620986:web:e1a4f469626cbd4f241cc3"
  }

  // init firebase app
  initializeApp(firebaseConfig)

  // init services
  const db = getFirestore()


  // collection ref
  const colRef = collection(db, 'JSS 1')


  // get collection data
  getDocs(colRef)
    .then((snapshot) => {
        let JSS_1 = []
        snapshot.docs.forEach((doc) => {
            JSS_1.push({ ...doc.data(), id: doc.id})
        })
        console.log(JSS_1)
    })
    .catch(err => {
        console.log(err.message)
    })
    


