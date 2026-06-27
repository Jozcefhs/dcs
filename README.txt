<!-- Redeploy trigger -->
DCA Admission Website - Rewritten Version

FILES TO KEEP/UPLOAD TO GITHUB:
- index.html
- verify.html
- application.html
- css/style.css
- js/verify.js
- js/application.js
- functions/api/verify.js
- functions/api/submit-application.js
- apps_script_backend.gs  (do not upload to website; paste into Google Apps Script)

GOOGLE SHEET SETUP:
1. Create/open your Google Sheet.
2. Extensions > Apps Script.
3. Paste apps_script_backend.gs.
4. Change SHARED_SECRET.
5. Deploy > New deployment > Web app.
6. Execute as: Me.
7. Who has access: Anyone.
8. Copy the Web App URL ending with /exec.

CLOUDFLARE PAGES ENVIRONMENT VARIABLES:
Set these in Cloudflare Pages > Settings > Environment variables:
- GOOGLE_APPS_SCRIPT_URL = your Apps Script Web App URL
- GOOGLE_APPS_SCRIPT_SECRET = same secret from Apps Script

SHEETS CREATED BY THE SCRIPT:
- FormSales: payment/verification records from the desktop app.
- Applications: completed admission application forms.

NOTES:
- The applicant verifies with email + code.
- After successful verification, application.html opens.
- The completed form is submitted to the Applications sheet.
- The old node_modules, dist, .git folder contents, and unused HTML files are not needed for this simple setup.
