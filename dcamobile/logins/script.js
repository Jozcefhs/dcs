
const firebaseConfig = {
    apiKey: "AIzaSyB1FJnKHGt3Ch1KGFuZz_UtZm1EH811NEU",
    authDomain: "fir-pro-152a1.firebaseapp.com",
    projectId: "fir-pro-152a1",
    storageBucket: "fir-pro-152a1.appspot.com",
    messagingSenderId: "158660765747",
    appId: "1:158660765747:web:bd2b4358cc5fc9067ddb46"
  };

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const login1 = document.querySelector('#login1')



login1.addEventListener('click', function () {
    console.log('We are ready to make this work')
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            const user = userCredential.user;
            alert(`Login successful! User UID: ${user.uid}`);
            // Perform further actions after successful login
            window.location.href = '/home/home.html'
        })
        .catch((error) => {
            console.error('Error logging in:', error.message);
            alert('Invalid email or password. Please try again.');
        });
})


 