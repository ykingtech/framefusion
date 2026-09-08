# EmailJS setup — The Aurelia 2K26

This package is already configured with:

- Service ID: `service_n7vufh1`
- Template ID: `template_x20qk9h`
- Public Key: `tcmdF1MKhr-uXACWd`
- Ticket portal: `https://lankaknot-source.github.io/Theaurelia/#ticket`

## Template dashboard settings

Open EmailJS → Email Templates → `template_x20qk9h`.

- **To Email:** `{{to_email}}`
- **From Name:** `The Aurelia 2K26`
- **Subject:** `🎟️ The Aurelia 2K26 Ticket Approved - {{ticket_number}}`
- Replace the template Content HTML with `emailjs-template.html` from this project.
- **Do not add an attachment.** This version intentionally uses no Dynamic Attachments, so it works without that paid feature.

Variables sent by the app:

- `{{to_email}}`
- `{{to_name}}`
- `{{event_name}}`
- `{{ticket_number}}`
- `{{full_name}}`
- `{{batch}}`
- `{{class_name}}`
- `{{id_number}}`
- `{{ticket_url}}`

## Flow

Admin approves payment → Firestore creates the unique ticket → EmailJS sends the approval email → user presses **VIEW MY QR TICKET** → user signs in with the same Google account → the portal reads their approved Firestore registration and displays the live unique QR.

The EmailJS Private Key is not used or stored in browser code.
