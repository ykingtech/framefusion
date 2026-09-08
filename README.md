# The Aurelia 2K26 — Final Spark + EmailJS build

This build includes the mobile Google-login fix, Spark/no-Blaze Firestore workflows, primary admin `lankaknot@gmail.com`, Firestore-compressed payment slips, approval/rejection, admin promotion, unique QR tickets, atomic one-time check-in, and EmailJS approval mail.

EmailJS is preconfigured with `service_n7vufh1` / `template_x20qk9h`. It does **not** use paid EmailJS attachments; the email contains a **VIEW MY QR TICKET** button instead. See `EMAILJS-SETUP.md`.

# The Aurelia 2K26 — Spark / No-Blaze Edition

This edition is designed to run without Firebase Cloud Functions, so Firebase's Blaze billing upgrade is not required for the app workflow.

## What works without Cloud Functions

- Google sign-in
- `lankaknot@gmail.com` as protected primary admin
- Promote/demote other signed-in users as full admins
- 2023 O/L and 2026 A/L registration
- Rs. 5,500 payment proof upload
- Client-side WebP compression and Firestore-only image chunks
- Admin payment-slip viewer
- Approval/rejection
- Unique manual ticket number protection using a Firestore transaction
- Cryptographically random unique QR token
- Ticket display in the user's portal
- QR scanner and one-time atomic check-in
- EmailJS ticket sending from the browser using the EmailJS Public Key

## 1. Deploy Firestore rules

From this folder:

```powershell
firebase login
firebase use the-aurelia-2k26
firebase deploy --only firestore:rules,firestore:indexes
```

Do **not** run `firebase deploy --only functions` in this edition. There is no `functions` folder.

## 2. GitHub Pages

Upload the complete project to the repository. In GitHub:

Settings -> Pages -> Source -> GitHub Actions

The included workflow publishes `index.html` and `src/` directly.

## 3. Firebase Authentication

Firebase Console -> Authentication -> Sign-in method -> Google -> Enable.

Firebase Console -> Authentication -> Settings -> Authorized domains -> add:

`lankaknot-source.github.io`

The protected primary admin is:

`lankaknot@gmail.com`

## 4. EmailJS

Open `src/emailjs-config.js`.

The Public Key is already set. Fill in:

```js
export const EMAILJS_SERVICE_ID = 'service_xxxxx';
export const EMAILJS_TEMPLATE_ID = 'template_xxxxx';
```

Copy `emailjs-template.html` into the EmailJS template HTML editor. Configure the template recipient with `{{to_email}}`. For the QR, configure a Variable Attachment with parameter name `qr_image` and CID `qr_image` so the included `<img src="cid:qr_image">` works.

This browser-only edition intentionally does NOT use the EmailJS Private Key. Never put the Private Key in browser JavaScript.

Because a Private Key was previously shared, rotate/regenerate it in EmailJS before using it for any future server-side integration.

## Security model

Privileged writes are protected by Firestore Security Rules. An admin is either:

1. the verified Google account `lankaknot@gmail.com`, or
2. a signed-in user whose `/users/{uid}` document has `admin: true`.

Normal users cannot set their own `admin` field. Ticket approval and check-in use Firestore transactions, so duplicate ticket numbers and simultaneous double scans are protected atomically.

## Mobile Google sign-in on GitHub Pages

This build uses `signInWithPopup()` on both desktop and mobile and explicitly enables `browserLocalPersistence`. The previous mobile-only `signInWithRedirect()` flow can lose its auth state when the app is hosted on GitHub Pages because modern browsers restrict cross-origin storage used by Firebase redirect helpers.

Also add `lankaknot-source.github.io` under Firebase Console > Authentication > Settings > Authorized domains.
