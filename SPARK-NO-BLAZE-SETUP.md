# Quick setup

1. Deploy only Firestore rules/indexes:
   `firebase deploy --only firestore:rules,firestore:indexes`
2. Push the project to GitHub.
3. GitHub Settings -> Pages -> Source = GitHub Actions.
4. Firebase Authentication -> Google = Enabled.
5. Add `lankaknot-source.github.io` to Firebase Authorized domains.
6. Sign in with `lankaknot@gmail.com` to open Admin Panel.
7. Add your EmailJS Service ID and Template ID in `src/emailjs-config.js` for automatic ticket emails.

No Cloud Functions deployment is needed in this edition.
