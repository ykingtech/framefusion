# AURELIA’26 — Premium Black & Gold Edition

This build preserves the existing Firebase/Auth/Firestore/EmailJS/QR/admin/check-in workflow and redesigns the user interface around the official AURELIA’26 black-and-gold event identity.

**Event details shown in the portal**
- St. Anne’s College, Kurunegala
- 2023 O/L × 2026 A/L Get Together
- 9 September 2026
- Asliya Golden Cassandra
- 6.30 PM onwards
- Current ticket price: LKR 6,000 (may be reduced depending on sponsorships)

Main entry remains **`Auraliya.html`**, so it can coexist with another `index.html` on the same server.

# The Aurelia 2K26 — Auraliya.html Edition

This is the full Spark/no-Blaze ticketing project.

## Main page

The portal entry file is **Auraliya.html**. There is intentionally no `index.html`, so you can copy this project into a server that already has its own `index.html` without replacing or conflicting with it.

Open the portal at, for example:

- `https://example.com/Auraliya.html`
- or, if placed in a folder: `https://example.com/aurelia/Auraliya.html`

Keep the `src/` folder beside `Auraliya.html`.

## Included fixes

- Premium downloadable PDF admission ticket
- Fixed `THE AURELIA 2K26` PDF title spacing; text no longer overlaps
- NIC Number field and Sri Lankan NIC validation
- Manual admin ticket-number input works with values such as `001`, `A26-001`, `A26/001`, `VIP.01`
- Safe Firestore lookup IDs for manual ticket numbers containing `/`
- Mobile + desktop Google popup login with local persistence
- `lankaknot@gmail.com` protected primary admin
- Firestore-compressed bank-slip storage
- Approval/rejection and admin promotion
- Unique QR ticket and one-time atomic check-in
- EmailJS approval email using `service_n7vufh1` + `template_x20qk9h`
- Approval email ticket button automatically links back to the current `Auraliya.html#ticket` URL

## Firestore deploy

```powershell
firebase login
firebase use the-aurelia-2k26
firebase deploy --only firestore:rules,firestore:indexes
```

Do not deploy Cloud Functions. This edition is designed for the Firebase Spark plan.

## Normal shared-server upload

Upload these together while leaving the server's existing `index.html` untouched:

- `Auraliya.html`
- `src/`

The other project/configuration files are included for development, Firebase rules, GitHub Pages, and maintenance.

## Firebase Authentication domain

Add the actual host/domain under Firebase Console -> Authentication -> Settings -> Authorized domains.

## EmailJS

The browser config is already set in `src/emailjs-config.js`.
The approval-email button uses the actual current `Auraliya.html` URL automatically, so no GitHub-only URL is hard-coded.
