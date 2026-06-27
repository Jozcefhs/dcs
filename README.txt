DCA Admission Website - Simple Version

Keep only these files/folders for the Cloudflare Pages site:

index.html
verify.html
application.html
css/style.css
functions/api/verify.js

Also use apps_script_admission_sales_expiry.gs in Google Apps Script. Do not upload this .gs file to Cloudflare unless you just want it as backup.

Cloudflare environment variables required:
GOOGLE_APPS_SCRIPT_URL = your Apps Script Web App URL ending with /exec
GOOGLE_APPS_SCRIPT_SECRET = the same secret in the Apps Script file

Flow:
1. Desktop app sells form and writes Email + VerificationCode + ExpiryDate + Used=NO to Google Sheet.
2. Applicant clicks Register on index.html.
3. verify.html sends email + code to /api/verify.
4. functions/api/verify.js checks Google Sheet through Apps Script.
5. If valid, code is marked Used=YES and applicant continues to application.html.
