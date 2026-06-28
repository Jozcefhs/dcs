DCA Admissions Manager - v2.5 Stable

Files included:
1. apps_script_backend.gs
   - Paste into Google Apps Script.
   - Confirm SHARED_SECRET matches Cloudflare GOOGLE_APPS_SCRIPT_SECRET.
   - Deploy using Manage deployments -> Edit -> New version -> Deploy.

2. js/application.js
   - Replace the existing js/application.js in the GitHub project.

3. functions/api/submit-application.js
   - Replace the existing Cloudflare Pages function.

4. success.html
   - Add this file to the website root, same level as index.html.

After replacing website files:
- Commit and push to GitHub.
- Wait for Cloudflare Pages deployment to complete.
- Test with a fresh unused verification code.

Stable behavior:
- Verification code is not used up during verification.
- Code is marked Used=YES only after successful application submission.
- Duplicate submissions are blocked by VerificationCode, not by email.
- Parent receives confirmation email.
- Admissions team receives notification email.
- Applicant sees success page with application reference.
