// document.addEventListener('DOMContentLoaded', function () {
//     // Check network status initially
//     updateFavicon();
    
//     // Listen for changes in network status
//     window.addEventListener('online', updateFavicon);
//     window.addEventListener('offline', updateFavicon);
//   });
  
//   function updateFavicon() {
//     // Get the favicon element
//     var favicon = document.getElementById('favicon');
  
//     // Check if the browser is online or offline
//     if (navigator.onLine) {
//       // Browser is online, set color favicon
//       favicon.href = '/dcamobile/images/real.png';
//     } else {
//       // Browser is offline, set grey favicon
//       favicon.href = '/dcamobile/images/grey-real.png';
//     }
//   }
  