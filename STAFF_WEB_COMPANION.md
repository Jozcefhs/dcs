# Staff Web Companion — Foundation Block

The staff portal at `admin.html` complements the desktop application. It uses the same Firestore collections and does not replace the desktop interface.

## Cloudflare environment variables

Add these encrypted variables to the Cloudflare Pages project:

- `ADMIN_WEB_USERNAME` — initial web Super Admin username; defaults to `admin` when omitted.
- `ADMIN_WEB_PASSWORD` — initial web Super Admin password.
- `STAFF_SESSION_SECRET` — a long, random secret used only to sign staff sessions. Use at least 32 random characters and do not reuse the admin password.

The existing Firestore service-account variables are also required:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Redeploy the Cloudflare Pages project after changing environment variables.

## Firestore staff accounts

The login API also supports documents in the `staffUsers` collection. Each document can contain:

- `Username`
- `DisplayName`
- `Role`
- `Department`
- `Active`
- `Salt`
- `PasswordHash`
- `PasswordIterations` — optional; defaults to `120000`.

Passwords use PBKDF2-HMAC-SHA256 and are compatible with the current desktop application's password format. Passwords themselves must never be stored in Firestore.

## Unified desktop and web accounts

The desktop app now synchronizes its local `users.json` cache with the Firestore `staffUsers` collection when running in Firestore mode:

- If Firestore already contains staff users, they replace the desktop login cache.
- If Firestore is empty and desktop users already exist, the desktop accounts are migrated to Firestore.
- Desktop user creation, password reset, role changes, activation and deletion are written to Firestore before the local cache is changed.
- Opening desktop User Management or switching users refreshes the Firestore account cache.
- Web sessions revalidate role, activation and deletion against Firestore on every protected request.

Only password hashes and unique salts are synchronized. Plaintext passwords are never saved.

New or reset accounts can be marked `MustChangePassword`. Both desktop and web interfaces require the temporary password to be replaced before access is granted.

Super Admins can use the web `Staff & Permissions` section to create, update, disable, reset or delete shared staff accounts. The system prevents deletion, deactivation or demotion of the final active Super Admin and records login/user-management activity in `staffSecurityAudit`.

## Current role access

- Super Admin and Management: all foundation dashboard sections.
- Admissions Officer: admissions, form purchases and students.
- Accounts Officer: students, accounts, clinic, kitchen and tuck shop summaries.
- Front Desk: admissions, form purchases and students.
- Clinic, Kitchen and Tuck Shop users: their own departmental section.
- Department User: section inferred from the assigned department.

## Bills and requisitions workflow

The `Bills & Requisitions` section now provides authenticated write workflows:

1. A department submits an expense requisition or supplier bill.
2. The record is saved as `Submitted` in `accountingExpenses` or `accountingSupplierBills`.
3. Management or Super Admin approves or rejects the submission. Configured accounting approval limits are enforced.
4. Accounts or Super Admin marks an approved record as reviewed.
5. Accounts completes final posting or supplier payment in the desktop Finance & Accounting tab, preserving its journal and bank controls.

Every web create, approval, rejection and Accounts review writes an entry to `accountingAudit` with the staff name, role, department, timestamp and `SourcePlatform: Web`.

The web workflow intentionally does not post journals or pay suppliers. Those final accounting actions remain in the desktop app.

## My Payroll and payslips

Every active staff role receives a private **My Payroll** section. A payroll profile must use the same username as the staff login. Only payroll runs that Accounts has posted are visible, and each user can see only their own payroll items. PDF payslips are generated on demand through the authenticated payroll endpoint and are not publicly stored.

Payroll preparation, approval, posting, and salary payments remain controlled from the desktop Finance & Accounting workspace. Management or Super Admin approves submitted payroll; Accounts or Super Admin posts it and records payments.
