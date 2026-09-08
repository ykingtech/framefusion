import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import { jsPDF } from 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';
import { Html5Qrcode } from 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/+esm';
import {
  onAuthStateChanged,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  runTransaction,
  where,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { auth, db, googleProvider } from './firebase.js';
import { initThreeBackground } from './three-bg.js';
import { EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, TICKET_PORTAL_URL } from './emailjs-config.js';
import { createEnhancedSlipUrl, readPaymentSlipBlob, savePaymentSlipToFirestore } from './firestore-images.js';
import {
  EVENT_NAME,
  EVENT_PRICE,
  compressImage,
  escapeHtml,
  formatDate,
  formatMoney,
  parseQrPayload,
  setBusy,
  toast,
} from './utils.js';

const app = document.querySelector('#app');
const PRIMARY_ADMIN_EMAIL = 'lankaknot@gmail.com';
const state = {
  user: null,
  isAdmin: false,
  registration: null,
  selectedBatch: null,
  unsubRegistration: null,
  scanner: null,
};

function randomTicketToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cleanTicketNumber(value) {
  const v = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  // Manual ticket numbers may be as short as a single digit and may contain
  // common separators such as A26/001, VIP-07, 2026.001 or A 001.
  if (!/^[A-Z0-9][A-Z0-9 ._\-/]{0,29}$/.test(v)) {
    throw new Error('Ticket number must be 1-30 characters using letters, numbers, spaces, -, _, . or /.');
  }
  return v;
}

function ticketNumberDocId(ticketNumber) {
  // Firestore document IDs cannot contain raw "/" path separators. Encoding keeps
  // the human ticket number unchanged while giving us a safe unique lookup key.
  return encodeURIComponent(ticketNumber);
}

function cleanNicNumber(value) {
  const nic = String(value || '').trim().replace(/[\s-]+/g, '').toUpperCase();
  if (!/^(?:\d{9}[VX]|\d{12})$/.test(nic)) {
    throw new Error('Enter a valid Sri Lankan NIC: 9 digits + V/X (old format) or 12 digits (new format).');
  }
  return nic;
}

function batchLabel(batch) {
  return batch === 'OL2023' ? '2023 O/L Batch' : batch === 'AL2026' ? '2026 A/L Batch' : String(batch || '');
}

async function sendTicketEmail(reg) {
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
    throw new Error('EmailJS configuration is incomplete. Check src/emailjs-config.js.');
  }

  // No EmailJS attachment is required on the free plan. The email contains a secure
  // button back to the portal; after Google sign-in the owner sees the live QR ticket.
  const currentPortal = `${window.location.origin}${window.location.pathname}#ticket`;
  const ticketUrl = TICKET_PORTAL_URL || currentPortal;

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: reg.email,
        to_name: reg.fullName,
        event_name: 'The Aurelia 2K26',
        ticket_number: reg.ticketNumber,
        full_name: reg.fullName,
        batch: batchLabel(reg.batch),
        class_name: reg.className,
        id_number: reg.idNumber,
        ticket_url: ticketUrl,
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`EmailJS ${response.status}: ${details || 'send failed'}`);
  }
  return true;
}

async function approveRegistrationDirect({ uid, ticketNumber }) {
  const number = cleanTicketNumber(ticketNumber);
  const registrationRef = doc(db, 'registrations', uid);
  const ticketNumberRef = doc(db, 'ticketNumbers', ticketNumberDocId(number));
  const token = randomTicketToken();
  const ticketRef = doc(db, 'tickets', token);
  let registrationData;

  await runTransaction(db, async (tx) => {
    const regSnap = await tx.get(registrationRef);
    if (!regSnap.exists()) throw new Error('Registration not found.');
    registrationData = regSnap.data();
    if (registrationData.status !== 'pending') throw new Error('Only pending registrations can be approved.');
    const numberSnap = await tx.get(ticketNumberRef);
    if (numberSnap.exists()) throw new Error('That ticket number is already in use.');

    tx.set(ticketNumberRef, { token, uid, createdAt: serverTimestamp() });
    tx.set(ticketRef, {
      token,
      ticketNumber: number,
      uid,
      email: registrationData.email,
      fullName: registrationData.fullName,
      batch: registrationData.batch,
      className: registrationData.className,
      idNumber: registrationData.idNumber,
      used: false,
      usedAt: null,
      usedBy: null,
      createdAt: serverTimestamp(),
      approvedBy: state.user.uid,
    });
    tx.update(registrationRef, {
      status: 'approved',
      ticketNumber: number,
      ticketToken: token,
      approvedAt: serverTimestamp(),
      approvedBy: state.user.uid,
      ticketUsed: false,
      updatedAt: serverTimestamp(),
      rejectionReason: null,
    });
  });

  try {
    await sendTicketEmail({ ...registrationData, ticketNumber: number, token });
    await setDoc(registrationRef, { emailStatus: 'sent', emailSentAt: serverTimestamp(), emailError: null }, { merge: true });
  } catch (error) {
    console.warn('EmailJS send failed:', error);
    await setDoc(registrationRef, { emailStatus: 'failed', emailError: String(error.message || error).slice(0, 500) }, { merge: true });
    toast('Ticket approved, but email could not be sent. Configure EmailJS IDs, then use Resend email.', 'error');
  }
  return { ticketNumber: number, token };
}

async function rejectRegistrationDirect({ uid, reason }) {
  const cleanReason = String(reason || '').trim().slice(0, 500);
  if (!uid || !cleanReason) throw new Error('UID and rejection reason are required.');
  const ref = doc(db, 'registrations', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Registration not found.');
    if (snap.data().status !== 'pending') throw new Error('Only pending registrations can be rejected.');
    tx.update(ref, { status: 'rejected', rejectionReason: cleanReason, rejectedAt: serverTimestamp(), rejectedBy: state.user.uid, updatedAt: serverTimestamp() });
  });
  return { ok: true };
}

async function resendTicketEmailDirect({ uid }) {
  const ref = doc(db, 'registrations', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Registration not found.');
  const reg = snap.data();
  if (reg.status !== 'approved' || !reg.ticketToken) throw new Error('Ticket is not approved.');
  await sendTicketEmail({ ...reg, token: reg.ticketToken });
  await setDoc(ref, { emailStatus: 'sent', emailSentAt: serverTimestamp(), emailError: null }, { merge: true });
  return { ok: true };
}

async function setUserAdminDirect({ uid, admin }) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('User not found.');
  const target = snap.data();
  if (String(target.email || '').toLowerCase() === PRIMARY_ADMIN_EMAIL && admin !== true) {
    throw new Error('The primary admin cannot be demoted.');
  }
  await setDoc(ref, { admin: admin === true, adminUpdatedAt: serverTimestamp(), adminUpdatedBy: state.user.uid }, { merge: true });
  return { ok: true, uid, admin: admin === true };
}

function publicTicket(ticket) {
  return {
    ticketNumber: ticket.ticketNumber,
    fullName: ticket.fullName,
    batch: ticket.batch,
    batchLabel: batchLabel(ticket.batch),
    className: ticket.className,
    idNumber: ticket.idNumber,
  };
}

async function checkInTicketDirect({ token }) {
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new Error('Invalid ticket token.');
  const ticketRef = doc(db, 'tickets', token);
  const checkinRef = doc(collection(db, 'checkins'));
  let result;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ticketRef);
    if (!snap.exists()) throw new Error('Ticket not found.');
    const ticket = snap.data();
    if (ticket.used === true) {
      result = { status: 'already_used', ...publicTicket(ticket), usedAt: ticket.usedAt || null };
      return;
    }
    tx.update(ticketRef, { used: true, usedAt: serverTimestamp(), usedBy: state.user.uid });
    tx.set(checkinRef, { token, ticketNumber: ticket.ticketNumber, uid: ticket.uid, checkedInBy: state.user.uid, checkedInAt: serverTimestamp() });
    tx.set(doc(db, 'registrations', ticket.uid), { ticketUsed: true, ticketUsedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    result = { status: 'checked_in', ...publicTicket(ticket) };
  });
  if (result?.status === 'already_used' && result.usedAt) result.usedAtText = formatDate(result.usedAt);
  return result;
}

// Spark-plan version: privileged actions are Firestore transactions protected by Firestore Rules.
// The wrapper shape matches Firebase callable functions, keeping the UI unchanged.
const fn = {
  setUserAdmin: async (data) => ({ data: await setUserAdminDirect(data) }),
  approveRegistration: async (data) => ({ data: await approveRegistrationDirect(data) }),
  rejectRegistration: async (data) => ({ data: await rejectRegistrationDirect(data) }),
  resendTicketEmail: async (data) => ({ data: await resendTicketEmailDirect(data) }),
  checkInTicket: async (data) => ({ data: await checkInTicketDirect(data) }),
};

initThreeBackground();

function pageShell(content, { nav = true } = {}) {
  const userName = escapeHtml(state.user?.displayName || state.user?.email || 'Guest');
  return `
    <main class="safe-shell mx-auto w-full max-w-7xl">
      ${nav ? `
      <header class="no-print mb-5 flex items-center justify-between gap-4 rounded-2xl px-1 py-2 sm:mb-8">
        <button data-action="home" class="flex min-w-0 items-center gap-3 text-left">
          <span class="aurelia-gradient grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-black text-slate-950">A26</span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-black tracking-[.14em] text-white sm:text-base">THE AURELIA 2K26</span>
            <span class="block text-xs text-slate-400">Secure Ticketing Portal</span>
          </span>
        </button>
        <div class="flex items-center gap-2">
          ${state.isAdmin ? `<button data-action="admin" class="btn-ghost hidden sm:block">Admin Panel</button>` : ''}
          <div class="hidden max-w-56 text-right md:block"><div class="truncate text-sm font-semibold">${userName}</div><div class="truncate text-xs text-slate-500">${escapeHtml(state.user?.email || '')}</div></div>
          <button data-action="logout" class="btn-ghost">Sign out</button>
        </div>
      </header>` : ''}
      ${content}
    </main>`;
}

function renderLoading(message = 'Loading your Aurelia portal...') {
  app.innerHTML = `<main class="safe-shell grid min-h-[100dvh] place-items-center"><div class="glass flex items-center gap-4 rounded-3xl px-6 py-5"><div class="loader"></div><div><div class="font-bold">${escapeHtml(message)}</div><div class="text-sm text-slate-400">Secure connection in progress</div></div></div></main>`;
}

function renderLogin() {
  state.selectedBatch = null;
  app.innerHTML = `
    <main class="safe-shell grid min-h-[100dvh] place-items-center py-8">
      <section class="glass w-full max-w-5xl overflow-hidden rounded-[2rem]">
        <div class="grid lg:grid-cols-[1.15fr_.85fr]">
          <div class="relative p-7 sm:p-10 lg:p-14">
            <div class="mb-10 inline-flex items-center gap-2 rounded-full border border-sky-300/15 bg-sky-300/5 px-3 py-1.5 text-xs font-bold tracking-[.16em] text-sky-200">OFFICIAL EVENT PORTAL</div>
            <div class="max-w-2xl">
              <h1 class="text-5xl font-black leading-[.92] tracking-[-.055em] text-white sm:text-7xl">THE <span class="aurelia-text">AURELIA</span><br>2K26</h1>
              <p class="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">Register, upload your payment proof, receive your unique QR ticket, and enter the function with one secure scan.</p>
            </div>
            <div class="mt-10 grid grid-cols-3 gap-3 text-center">
              <div class="glass-soft rounded-2xl p-3"><div class="text-lg font-black text-sky-300">01</div><div class="mt-1 text-xs text-slate-400">Register</div></div>
              <div class="glass-soft rounded-2xl p-3"><div class="text-lg font-black text-emerald-300">02</div><div class="mt-1 text-xs text-slate-400">Approve</div></div>
              <div class="glass-soft rounded-2xl p-3"><div class="text-lg font-black text-yellow-200">03</div><div class="mt-1 text-xs text-slate-400">Scan</div></div>
            </div>
          </div>
          <div class="border-t border-white/5 bg-slate-950/35 p-7 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
            <div class="mb-8">
              <div class="text-xs font-extrabold tracking-[.18em] text-emerald-300">WELCOME</div>
              <h2 class="mt-2 text-3xl font-black">Continue with Google</h2>
              <p class="mt-2 text-sm leading-6 text-slate-400">Your Gmail address becomes your ticket contact email automatically.</p>
            </div>
            <button id="google-login" class="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 py-4 font-black text-slate-900 transition hover:bg-slate-100">
              <svg viewBox="0 0 24 24" class="h-5 w-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.09-1.93 3.27-4.77 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.98 0 5.48-.99 7.31-2.68l-3.57-2.77c-.99.66-2.26 1.05-3.74 1.05-2.87 0-5.3-1.94-6.17-4.54H2.14v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.83 14.06A6.6 6.6 0 0 1 5.49 12c0-.72.12-1.41.34-2.06V7.1H2.14A11 11 0 0 0 1 12c0 1.77.42 3.45 1.14 4.9l3.69-2.84z"/><path fill="#EA4335" d="M12 5.4c1.62 0 3.06.56 4.2 1.64l3.15-3.15A10.56 10.56 0 0 0 12 1 11 11 0 0 0 2.14 7.1l3.69 2.84C6.7 7.34 9.13 5.4 12 5.4z"/></svg>
              Sign in with Google
            </button>
            <div class="mt-6 rounded-2xl border border-yellow-300/10 bg-yellow-300/5 p-4 text-xs leading-5 text-slate-400">Ticket price: <strong class="text-yellow-200">${formatMoney(EVENT_PRICE)}</strong>. Payment confirmation is completed manually by the event administration team.</div>
          </div>
        </div>
      </section>
    </main>`;

  document.querySelector('#google-login')?.addEventListener('click', handleGoogleLogin);
}

async function handleGoogleLogin() {
  const btn = document.querySelector('#google-login');
  setBusy(btn, true, 'Opening Google...');
  try {
    // GitHub Pages + Firebase redirect auth can fail on modern mobile browsers
    // because the auth helper lives on a different origin. Use a user-initiated
    // popup on every device and explicitly keep the Firebase session locally.
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error(error);
    const code = String(error?.code || '');
    if (code === 'auth/popup-blocked') {
      toast('Google sign-in popup was blocked. Allow pop-ups for this site and try again.', 'error');
    } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      toast('Google sign-in was cancelled. Please try again.', 'error');
    } else {
      toast(error.message || 'Google sign-in failed.', 'error');
    }
    setBusy(btn, false);
  }
}

async function prepareSignedInUser(user) {
  state.user = user;
  renderLoading('Preparing your account...');

  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    lastLoginAt: serverTimestamp(),
  }, { merge: true });

  const userDoc = await getDoc(doc(db, 'users', user.uid));
  const signedInEmail = String(user.email || '').trim().toLowerCase();
  const isPrimaryAdmin = signedInEmail === PRIMARY_ADMIN_EMAIL && user.emailVerified === true;
  state.isAdmin = isPrimaryAdmin || userDoc.data()?.admin === true;

  state.unsubRegistration?.();
  state.unsubRegistration = onSnapshot(doc(db, 'registrations', user.uid), (snap) => {
    state.registration = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (!location.hash.startsWith('#admin') && !location.hash.startsWith('#scanner')) renderHome();
  }, (error) => {
    console.error(error);
    toast('Could not load registration.', 'error');
  });
}

function renderHome() {
  stopScanner();
  if (!state.user) return renderLogin();
  if (!state.registration) return renderBatchSelection();
  return renderRegistrationStatus(state.registration);
}

function renderBatchSelection() {
  app.innerHTML = pageShell(`
    <section class="mx-auto max-w-5xl py-5 sm:py-10">
      <div class="mb-7 max-w-2xl">
        <div class="text-xs font-extrabold tracking-[.18em] text-sky-300">STEP 01</div>
        <h1 class="mt-2 text-3xl font-black sm:text-5xl">Choose your batch</h1>
        <p class="mt-3 text-slate-400">This decides which class field appears on your registration.</p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <button data-batch="OL2023" class="group glass relative overflow-hidden rounded-[1.7rem] p-6 text-left transition hover:-translate-y-1 hover:border-sky-300/30 sm:p-8">
          <div class="absolute right-5 top-4 text-6xl font-black text-sky-300/5">23</div>
          <div class="mb-8 grid h-12 w-12 place-items-center rounded-2xl bg-sky-400/10 text-lg font-black text-sky-300">O/L</div>
          <h2 class="text-2xl font-black">2023 O/L Batch</h2>
          <p class="mt-2 text-sm leading-6 text-slate-400">For students from the 2023 O/L batch. Your previous O/L class will be requested.</p>
          <div class="mt-7 text-sm font-bold text-sky-300">Continue →</div>
        </button>
        <button data-batch="AL2026" class="group glass relative overflow-hidden rounded-[1.7rem] p-6 text-left transition hover:-translate-y-1 hover:border-emerald-300/30 sm:p-8">
          <div class="absolute right-5 top-4 text-6xl font-black text-emerald-300/5">26</div>
          <div class="mb-8 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/10 text-lg font-black text-emerald-300">A/L</div>
          <h2 class="text-2xl font-black">2026 A/L Batch</h2>
          <p class="mt-2 text-sm leading-6 text-slate-400">For students from the 2026 A/L batch. Your current A/L class will be requested.</p>
          <div class="mt-7 text-sm font-bold text-emerald-300">Continue →</div>
        </button>
      </div>
    </section>`);

  document.querySelectorAll('[data-batch]').forEach((el) => el.addEventListener('click', () => {
    state.selectedBatch = el.dataset.batch;
    renderRegistrationForm();
  }));
  bindGlobalActions();
}

function renderRegistrationForm() {
  const isOL = state.selectedBatch === 'OL2023';
  app.innerHTML = pageShell(`
    <section class="mx-auto max-w-3xl py-4 sm:py-8">
      <div class="glass rounded-[1.8rem] p-5 sm:p-8">
        <div class="mb-7 flex items-start justify-between gap-4">
          <div>
            <div class="text-xs font-extrabold tracking-[.18em] text-emerald-300">STEP 02 · REGISTRATION</div>
            <h1 class="mt-2 text-3xl font-black">${isOL ? '2023 O/L' : '2026 A/L'} Batch</h1>
            <p class="mt-2 text-sm text-slate-400">Ticket fee: <span class="font-bold text-yellow-200">${formatMoney(EVENT_PRICE)}</span></p>
          </div>
          <button id="change-batch" class="btn-ghost text-sm">Change</button>
        </div>

        <form id="registration-form" class="space-y-5">
          <div>
            <label class="mb-2 block text-sm font-bold">Full name</label>
            <input class="field" name="fullName" required minlength="3" maxlength="100" autocomplete="name" placeholder="Your full name" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-bold">${isOL ? 'O/L class' : 'A/L class'}</label>
            <input class="field" name="className" required maxlength="50" placeholder="e.g. 11-A / 13-Maths-A" />
          </div>
          <div>
            <label class="mb-2 block text-sm font-bold">NIC number</label>
            <input class="field" name="idNumber" required minlength="10" maxlength="12" inputmode="text" autocapitalize="characters" autocomplete="off" pattern="(?:[0-9]{9}[VvXx]|[0-9]{12})" title="Enter 9 digits followed by V/X, or a 12-digit NIC" placeholder="e.g. 200712345678 or 981234567V" />
            <p class="mt-2 text-xs text-slate-500">Sri Lankan NIC: old format (9 digits + V/X) or new 12-digit format.</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-bold">Gmail address</label>
            <input class="field opacity-70" value="${escapeHtml(state.user.email || '')}" disabled />
            <p class="mt-2 text-xs text-slate-500">Your approval email will be sent to this Google account with a button to open your live QR ticket.</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-bold">Bank payment slip</label>
            <label class="block cursor-pointer rounded-2xl border border-dashed border-slate-600/70 bg-slate-950/35 p-5 text-center transition hover:border-sky-400/50">
              <input id="slip-file" class="sr-only" type="file" name="paymentSlip" accept="image/jpeg,image/png,image/webp" required />
              <div class="text-2xl">↑</div>
              <div class="mt-2 font-bold">Upload payment proof</div>
              <div id="file-label" class="mt-1 text-xs text-slate-500">JPG, PNG or WebP · auto-compressed before upload</div>
            </label>
          </div>
          <label class="flex items-start gap-3 rounded-2xl bg-slate-950/35 p-4 text-sm text-slate-400">
            <input class="mt-1" type="checkbox" required />
            <span>I confirm that the submitted details and payment proof are correct.</span>
          </label>
          <button id="submit-registration" class="btn-primary w-full" type="submit">Submit for approval</button>
        </form>
      </div>
    </section>`);

  document.querySelector('#change-batch')?.addEventListener('click', () => {
    state.selectedBatch = null;
    renderBatchSelection();
  });
  document.querySelector('#slip-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    document.querySelector('#file-label').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'JPG, PNG or WebP · auto-compressed before upload';
  });
  document.querySelector('#registration-form')?.addEventListener('submit', submitRegistration);
  bindGlobalActions();
}

async function submitRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = document.querySelector('#submit-registration');
  const data = new FormData(form);
  const file = data.get('paymentSlip');
  setBusy(btn, true, 'Compressing & uploading...');

  try {
    if (!state.user || !state.selectedBatch) throw new Error('Session information is missing.');
    const existing = await getDoc(doc(db, 'registrations', state.user.uid));
    if (existing.exists()) throw new Error('A registration already exists for this account.');

    const compressed = await compressImage(file);
    setBusy(btn, true, 'Saving secure photo chunks...');
    const slip = await savePaymentSlipToFirestore(state.user.uid, compressed);

    await setDoc(doc(db, 'registrations', state.user.uid), {
      uid: state.user.uid,
      email: state.user.email,
      fullName: String(data.get('fullName')).trim(),
      batch: state.selectedBatch,
      className: String(data.get('className')).trim(),
      idNumber: cleanNicNumber(data.get('idNumber')),
      paymentAmount: EVENT_PRICE,
      paymentSlipId: slip.slipId,
      paymentSlipBytes: slip.byteLength,
      paymentSlipChunks: slip.chunkCount,
      paymentSlipMimeType: slip.mimeType,
      status: 'pending',
      ticketNumber: null,
      ticketToken: null,
      rejectionReason: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    toast('Registration submitted for approval.', 'success');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Submission failed.', 'error');
    setBusy(btn, false);
  }
}

async function renderRegistrationStatus(reg) {
  if (reg.status === 'approved' && reg.ticketToken) return renderApprovedTicket(reg);
  const pending = reg.status === 'pending';
  const rejected = reg.status === 'rejected';
  app.innerHTML = pageShell(`
    <section class="mx-auto max-w-3xl py-6 sm:py-12">
      <div class="glass rounded-[2rem] p-6 sm:p-10">
        <div class="mb-7 grid h-16 w-16 place-items-center rounded-3xl ${pending ? 'bg-yellow-300/10 text-yellow-200' : 'bg-red-400/10 text-red-300'} text-3xl">${pending ? '⌛' : '!'}</div>
        <div class="text-xs font-extrabold tracking-[.18em] ${pending ? 'text-yellow-200' : 'text-red-300'}">${pending ? 'APPROVAL PENDING' : 'REGISTRATION REJECTED'}</div>
        <h1 class="mt-2 text-3xl font-black sm:text-5xl">${pending ? 'Your submission is under review.' : 'Action is required.'}</h1>
        <p class="mt-4 max-w-2xl leading-7 text-slate-400">${pending ? 'The admin team will check your payment slip. When approved, your unique QR ticket will appear here and an approval email with a secure ticket button will be sent automatically.' : `Reason: ${escapeHtml(reg.rejectionReason || 'Please contact the event administration team.')}`}</p>

        <div class="mt-8 grid gap-3 sm:grid-cols-2">
          <div class="glass-soft rounded-2xl p-4"><div class="text-xs text-slate-500">Name</div><div class="mt-1 font-bold">${escapeHtml(reg.fullName)}</div></div>
          <div class="glass-soft rounded-2xl p-4"><div class="text-xs text-slate-500">Batch</div><div class="mt-1 font-bold">${reg.batch === 'OL2023' ? '2023 O/L' : '2026 A/L'}</div></div>
          <div class="glass-soft rounded-2xl p-4"><div class="text-xs text-slate-500">Class</div><div class="mt-1 font-bold">${escapeHtml(reg.className)}</div></div>
          <div class="glass-soft rounded-2xl p-4"><div class="text-xs text-slate-500">NIC Number</div><div class="mt-1 font-bold">${escapeHtml(reg.idNumber)}</div></div>
        </div>

        ${state.isAdmin ? `<button data-action="admin" class="btn-primary mt-6 w-full sm:w-auto">Open Admin Panel</button>` : ''}
      </div>
    </section>`);
  bindGlobalActions();
}


function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawPdfText(ctx, text, x, y, maxWidth, startSize, weight = 700, color = '#ffffff') {
  const value = String(text || '-');
  let size = startSize;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  while (size > 22) {
    ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`;
    if (ctx.measureText(value).width <= maxWidth) break;
    size -= 2;
  }
  ctx.fillText(value, x, y, maxWidth);
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render QR image for the PDF.'));
    img.src = src;
  });
}

async function downloadTicketPdf(reg, qrData, used = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 2100;
  canvas.height = 900;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('PDF canvas is not supported by this browser.');

  // Premium dark-blue base.
  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, '#06111f');
  bg.addColorStop(.55, '#0a2033');
  bg.addColorStop(1, '#071522');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Aurelia blue -> green -> yellow signature strip.
  const strip = ctx.createLinearGradient(0, 0, canvas.width, 0);
  strip.addColorStop(0, '#38bdf8');
  strip.addColorStop(.52, '#4ade80');
  strip.addColorStop(1, '#fde047');
  ctx.fillStyle = strip;
  ctx.fillRect(0, 0, canvas.width, 24);

  // Decorative premium glow shapes.
  ctx.globalAlpha = .10;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.arc(210 + i * 190, 90 + (i % 2) * 70, 150 + i * 18, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#fde047';
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(1810, 110, 110 + i * 85, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Ticket frame.
  roundRectPath(ctx, 58, 64, 1984, 774, 50);
  ctx.fillStyle = 'rgba(3, 12, 23, .80)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(125, 211, 252, .26)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Perforation between ticket body and QR stub.
  ctx.save();
  ctx.setLineDash([18, 16]);
  ctx.strokeStyle = 'rgba(148, 163, 184, .38)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(1435, 100);
  ctx.lineTo(1435, 800);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#06111f';
  ctx.beginPath(); ctx.arc(1435, 64, 28, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(1435, 838, 28, 0, Math.PI * 2); ctx.fill();

  // Brand header. Keep THE AURELIA + 2K26 on one clean line without overlap.
  ctx.font = '800 28px Inter, Arial, sans-serif';
  ctx.fillStyle = '#7dd3fc';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillText('OFFICIAL ADMISSION TICKET', 120, 150);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  const brandMain = 'THE AURELIA';
  const brandYear = '2K26';
  const brandX = 120;
  const brandMaxWidth = 1210;
  const brandGap = 34;
  let brandSize = 78;
  let mainWidth = 0;
  let yearWidth = 0;
  while (brandSize >= 54) {
    ctx.font = `900 ${brandSize}px Inter, Arial, sans-serif`;
    mainWidth = ctx.measureText(brandMain).width;
    yearWidth = ctx.measureText(brandYear).width;
    if (mainWidth + brandGap + yearWidth <= brandMaxWidth) break;
    brandSize -= 2;
  }
  ctx.font = `900 ${brandSize}px Inter, Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(brandMain, brandX, 245);
  ctx.fillStyle = '#fde047';
  ctx.fillText(brandYear, brandX + mainWidth + brandGap, 245);

  // Status badge.
  roundRectPath(ctx, 1155, 126, 190, 62, 31);
  ctx.fillStyle = used ? 'rgba(248,113,113,.15)' : 'rgba(74,222,128,.14)';
  ctx.fill();
  ctx.strokeStyle = used ? '#f87171' : '#4ade80';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = '900 28px Inter, Arial, sans-serif';
  ctx.fillStyle = used ? '#fecaca' : '#bbf7d0';
  ctx.textAlign = 'center';
  ctx.fillText(used ? 'USED' : 'VALID', 1250, 167);
  ctx.textAlign = 'left';

  // Guest name.
  ctx.font = '700 24px Inter, Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('TICKET HOLDER', 120, 330);
  drawPdfText(ctx, reg.fullName, 120, 398, 1190, 58, 900, '#ffffff');

  const fields = [
    ['TICKET NUMBER', reg.ticketNumber, '#fde68a'],
    ['BATCH', batchLabel(reg.batch), '#ffffff'],
    ['CLASS', reg.className, '#ffffff'],
    ['NIC NUMBER', reg.idNumber, '#ffffff'],
  ];
  const positions = [
    [120, 490], [740, 490], [120, 625], [740, 625],
  ];
  fields.forEach(([label, value, valueColor], index) => {
    const [x, y] = positions[index];
    ctx.font = '700 21px Inter, Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(label, x, y);
    drawPdfText(ctx, value, x, y + 48, 540, 36, 800, valueColor);
  });

  // Bottom security notice.
  roundRectPath(ctx, 120, 710, 1225, 78, 22);
  ctx.fillStyle = 'rgba(250, 204, 21, .055)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(253, 224, 71, .17)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = '700 22px Inter, Arial, sans-serif';
  ctx.fillStyle = '#fde68a';
  ctx.fillText('SINGLE ENTRY', 150, 756);
  ctx.font = '500 20px Inter, Arial, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Present this QR at the entrance. The first successful scan permanently marks this ticket as USED.', 335, 756, 970);

  // QR stub.
  const qrImage = await loadCanvasImage(qrData);
  roundRectPath(ctx, 1535, 180, 410, 410, 38);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.drawImage(qrImage, 1565, 210, 350, 350);

  ctx.textAlign = 'center';
  ctx.font = '900 23px Inter, Arial, sans-serif';
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText('SCAN AT ENTRANCE', 1740, 648);
  drawPdfText(ctx, reg.ticketNumber, 1560, 700, 360, 34, 900, '#fde68a');
  ctx.textAlign = 'center';
  ctx.font = '600 18px Inter, Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('THE AURELIA 2K26', 1740, 756);
  ctx.fillText('Secure QR Admission', 1740, 786);
  ctx.textAlign = 'left';

  // Render the designed ticket as one crisp landscape PDF page.
  const image = canvas.toDataURL('image/jpeg', 0.95);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [210, 90], compress: true });
  pdf.setProperties({
    title: `The Aurelia 2K26 - ${reg.ticketNumber}`,
    subject: 'Official admission ticket',
    author: 'The Aurelia 2K26',
    creator: 'The Aurelia 2K26 Secure Ticketing Portal',
  });
  pdf.addImage(image, 'JPEG', 0, 0, 210, 90, undefined, 'FAST');
  const safeNumber = String(reg.ticketNumber || 'ticket').replace(/[^A-Za-z0-9_-]+/g, '-');
  pdf.save(`The-Aurelia-2K26-${safeNumber}.pdf`);
}

async function renderApprovedTicket(reg) {
  let ticket = null;
  try {
    const snap = await getDoc(doc(db, 'tickets', reg.ticketToken));
    if (snap.exists()) ticket = snap.data();
  } catch (error) {
    console.error(error);
  }
  const qrPayload = `AURELIA2K26:${reg.ticketToken}`;
  const qrData = await QRCode.toDataURL(qrPayload, { width: 720, margin: 2, errorCorrectionLevel: 'H' });
  const used = ticket?.used === true;

  app.innerHTML = pageShell(`
    <section class="mx-auto max-w-4xl py-5 sm:py-10">
      <div class="mb-5 flex flex-wrap items-center justify-between gap-3 no-print">
        <div><div class="text-xs font-extrabold tracking-[.18em] text-emerald-300">APPROVED</div><h1 class="mt-1 text-3xl font-black">Your official ticket</h1></div>
        <div class="flex gap-2"><button id="download-ticket-pdf" class="btn-ghost">Download PDF Ticket</button>${state.isAdmin ? `<button data-action="admin" class="btn-primary">Admin Panel</button>` : ''}</div>
      </div>
      <article class="ticket-shell">
        <div class="grid lg:grid-cols-[1fr_310px]">
          <div class="p-6 sm:p-9">
            <div class="mb-10 flex items-center justify-between gap-4">
              <div><div class="text-xs font-black tracking-[.22em] text-sky-300">THE AURELIA</div><div class="mt-1 text-4xl font-black tracking-[-.04em] sm:text-5xl">2K26</div></div>
              <div class="rounded-full border px-3 py-1.5 text-xs font-extrabold ${used ? 'border-red-400/30 bg-red-400/10 text-red-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}">${used ? 'USED' : 'VALID'}</div>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="sm:col-span-2"><div class="text-xs uppercase tracking-wider text-slate-500">Guest</div><div class="mt-1 text-2xl font-black">${escapeHtml(reg.fullName)}</div></div>
              <div><div class="text-xs uppercase tracking-wider text-slate-500">Ticket No.</div><div class="mt-1 text-lg font-black text-yellow-200">${escapeHtml(reg.ticketNumber)}</div></div>
              <div><div class="text-xs uppercase tracking-wider text-slate-500">Batch</div><div class="mt-1 font-bold">${reg.batch === 'OL2023' ? '2023 O/L Batch' : '2026 A/L Batch'}</div></div>
              <div><div class="text-xs uppercase tracking-wider text-slate-500">Class</div><div class="mt-1 font-bold">${escapeHtml(reg.className)}</div></div>
              <div><div class="text-xs uppercase tracking-wider text-slate-500">NIC No.</div><div class="mt-1 font-bold">${escapeHtml(reg.idNumber)}</div></div>
            </div>
            <div class="mt-10 rounded-2xl border border-yellow-200/10 bg-yellow-200/5 p-4 text-sm leading-6 text-slate-400"><span class="font-bold text-yellow-100">Single-entry ticket.</span> The QR becomes USED immediately after a successful admin scan at the entrance.</div>
          </div>
          <div class="ticket-cut flex flex-col items-center justify-center bg-white/[.025] p-6 lg:border-l lg:border-t-0 lg:border-dashed lg:border-slate-600/40">
            <div class="rounded-3xl bg-white p-4 shadow-2xl"><img src="${qrData}" alt="Unique Aurelia 2K26 QR code" class="h-[230px] w-[230px]" /></div>
            <div class="mt-4 text-center"><div class="text-xs font-bold tracking-[.18em] text-slate-500">SCAN AT ENTRANCE</div><div class="mt-1 text-sm font-black text-slate-200">${escapeHtml(reg.ticketNumber)}</div></div>
          </div>
        </div>
      </article>
      ${used ? `<div class="mt-4 rounded-2xl border border-red-400/20 bg-red-950/25 p-4 text-sm text-red-200">This ticket has already been checked in${ticket?.usedAt ? ` on ${formatDate(ticket.usedAt)}` : ''}.</div>` : ''}
    </section>`);

  document.querySelector('#download-ticket-pdf')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    setBusy(btn, true, 'Creating PDF...');
    try {
      await downloadTicketPdf(reg, qrData, used);
      toast('PDF ticket downloaded.', 'success');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not create the PDF ticket.', 'error');
    } finally {
      setBusy(btn, false);
    }
  });
  bindGlobalActions();
}

async function renderAdmin() {
  stopScanner();
  if (!state.isAdmin) return renderHome();
  location.hash = '#admin';
  app.innerHTML = pageShell(`
    <section class="py-3 sm:py-7">
      <div class="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><div class="text-xs font-extrabold tracking-[.18em] text-yellow-200">ADMIN CONTROL CENTER</div><h1 class="mt-2 text-3xl font-black sm:text-5xl">The Aurelia 2K26</h1></div>
        <button data-action="scanner" class="btn-primary">Open QR Scanner</button>
      </div>
      <div id="admin-stats" class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"></div>
      <div class="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <div class="glass rounded-[1.7rem] p-4 sm:p-6">
          <div class="mb-4 flex items-center justify-between"><div><div class="text-lg font-black">Registrations</div><div class="text-xs text-slate-500">Newest submissions first</div></div><button id="refresh-admin" class="btn-ghost text-sm">Refresh</button></div>
          <div id="admin-registrations" class="space-y-3"><div class="py-10 text-center text-slate-500">Loading registrations...</div></div>
        </div>
        <div class="glass rounded-[1.7rem] p-4 sm:p-6">
          <div class="mb-4"><div class="text-lg font-black">Admin access</div><div class="text-xs text-slate-500">Promote any signed-in user to full admin</div></div>
          <div id="admin-users" class="space-y-3"><div class="py-10 text-center text-slate-500">Loading users...</div></div>
        </div>
      </div>
    </section>`);
  bindGlobalActions();
  document.querySelector('#refresh-admin')?.addEventListener('click', loadAdminData);
  await loadAdminData();
}

async function loadAdminData() {
  const regContainer = document.querySelector('#admin-registrations');
  const userContainer = document.querySelector('#admin-users');
  if (!regContainer || !userContainer) return;

  try {
    const [regSnap, userSnap] = await Promise.all([
      getDocs(query(collection(db, 'registrations'), orderBy('createdAt', 'desc'), limit(200))),
      getDocs(query(collection(db, 'users'), orderBy('lastLoginAt', 'desc'), limit(200))),
    ]);
    const regs = regSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const users = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const counts = {
      total: regs.length,
      pending: regs.filter(r => r.status === 'pending').length,
      approved: regs.filter(r => r.status === 'approved').length,
      used: regs.filter(r => r.ticketUsed === true).length,
    };
    document.querySelector('#admin-stats').innerHTML = [
      ['Total', counts.total, 'text-sky-300'],
      ['Pending', counts.pending, 'text-yellow-200'],
      ['Approved', counts.approved, 'text-emerald-300'],
      ['Checked in', counts.used, 'text-violet-300'],
    ].map(([k,v,c]) => `<div class="glass-soft rounded-2xl p-4"><div class="text-xs text-slate-500">${k}</div><div class="mt-1 text-3xl font-black ${c}">${v}</div></div>`).join('');

    regContainer.innerHTML = regs.length ? regs.map(registrationAdminCard).join('') : `<div class="py-10 text-center text-slate-500">No registrations yet.</div>`;
    userContainer.innerHTML = users.length ? users.map(userAdminCard).join('') : `<div class="py-10 text-center text-slate-500">No users yet.</div>`;
    bindAdminCardActions(regs, users);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not load admin data.', 'error');
  }
}

function registrationAdminCard(r) {
  const statusTone = r.status === 'approved' ? 'text-emerald-300 bg-emerald-400/10' : r.status === 'rejected' ? 'text-red-300 bg-red-400/10' : 'text-yellow-200 bg-yellow-300/10';
  return `<article class="rounded-2xl border border-white/[.06] bg-slate-950/30 p-4" data-reg-card="${r.id}">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0"><div class="truncate font-black">${escapeHtml(r.fullName)}</div><div class="mt-1 truncate text-xs text-slate-500">${escapeHtml(r.email)} · ${r.batch === 'OL2023' ? '2023 O/L' : '2026 A/L'} · ${escapeHtml(r.className)}</div></div>
      <span class="rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${statusTone}">${escapeHtml(r.status)}</span>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div class="rounded-xl bg-white/[.025] p-2.5"><div class="text-slate-600">NIC</div><div class="mt-1 truncate font-semibold text-slate-300">${escapeHtml(r.idNumber)}</div></div>
      <div class="rounded-xl bg-white/[.025] p-2.5"><div class="text-slate-600">Amount</div><div class="mt-1 font-semibold text-slate-300">${formatMoney(r.paymentAmount || EVENT_PRICE)}</div></div>
      <div class="rounded-xl bg-white/[.025] p-2.5"><div class="text-slate-600">Ticket</div><div class="mt-1 truncate font-semibold text-yellow-100">${escapeHtml(r.ticketNumber || '—')}</div></div>
      <div class="rounded-xl bg-white/[.025] p-2.5"><div class="text-slate-600">Submitted</div><div class="mt-1 truncate font-semibold text-slate-300">${formatDate(r.createdAt)}</div></div>
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <button data-view-slip="${r.id}" class="btn-ghost text-sm">View slip</button>
      ${r.status === 'approved' ? `<button data-resend="${r.id}" class="btn-ghost text-sm">Resend email</button>` : ''}
    </div>
    ${r.status === 'pending' ? `
      <div class="mt-3 rounded-2xl border border-sky-300/10 bg-sky-300/[.035] p-3">
        <label class="mb-2 block text-[11px] font-black uppercase tracking-[.14em] text-sky-300">Manual Ticket Number</label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input data-ticket-input="${r.id}" class="field flex-1" maxlength="30" autocomplete="off" placeholder="e.g. 001 or A26/001" />
          <button data-approve="${r.id}" class="btn-primary whitespace-nowrap text-sm">Approve & Issue</button>
          <button data-reject="${r.id}" class="btn-danger whitespace-nowrap text-sm">Reject</button>
        </div>
        <div class="mt-2 text-[11px] text-slate-500">1-30 characters. Numbers, letters and separators such as / - _ . are supported.</div>
      </div>` : ''}
  </article>`;
}

function userAdminCard(u) {
  const protectedAdmin = String(u.email || '').toLowerCase() === 'lankaknot@gmail.com';
  const isAdminMirror = u.admin === true || protectedAdmin;
  return `<article class="rounded-2xl border border-white/[.06] bg-slate-950/30 p-4">
    <div class="flex items-start gap-3">
      ${u.photoURL ? `<img src="${escapeHtml(u.photoURL)}" class="h-10 w-10 rounded-full" referrerpolicy="no-referrer" />` : `<div class="grid h-10 w-10 place-items-center rounded-full bg-sky-400/10 font-black text-sky-300">${escapeHtml((u.displayName || u.email || '?')[0])}</div>`}
      <div class="min-w-0 flex-1"><div class="truncate font-bold">${escapeHtml(u.displayName || 'Unnamed user')}</div><div class="truncate text-xs text-slate-500">${escapeHtml(u.email || '')}</div></div>
    </div>
    <div class="mt-3 flex items-center justify-between gap-3">
      <span class="text-xs ${isAdminMirror ? 'text-emerald-300' : 'text-slate-500'}">${isAdminMirror ? 'Full admin' : 'Standard user'}</span>
      ${protectedAdmin ? `<span class="rounded-full bg-yellow-300/10 px-2 py-1 text-[10px] font-black text-yellow-200">PRIMARY ADMIN</span>` : `<button data-admin-user="${u.id}" data-admin-value="${isAdminMirror ? 'false' : 'true'}" class="btn-ghost text-xs">${isAdminMirror ? 'Remove admin' : 'Make admin'}</button>`}
    </div>
  </article>`;
}

async function showPaymentSlip(reg) {
  if (!reg?.paymentSlipId) {
    toast('This registration has no Firestore payment-slip reference.', 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[100] grid place-items-center bg-slate-950/90 p-3 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="glass relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.7rem]">
      <div class="flex items-center justify-between border-b border-white/[.06] p-4 sm:px-6">
        <div><div class="text-xs font-black tracking-[.16em] text-sky-300">PAYMENT PROOF</div><div class="mt-1 font-black">${escapeHtml(reg.fullName)}</div></div>
        <button data-close-slip class="btn-ghost text-sm">Close</button>
      </div>
      <div class="grid min-h-0 flex-1 place-items-center overflow-auto bg-black/20 p-3 sm:p-6">
        <div id="slip-loading" class="flex items-center gap-3 py-16 text-slate-400"><div class="loader"></div><div>Loading compressed Firestore image...</div></div>
        <img id="slip-image" class="hidden max-h-[78dvh] max-w-full rounded-xl object-contain shadow-2xl" alt="Bank payment slip" />
      </div>
      <div class="border-t border-white/[.06] px-4 py-3 text-xs text-slate-500 sm:px-6">Stored as compressed WebP chunks in Cloud Firestore. Viewer applies high-quality browser resampling for clearer inspection.</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => {
    const img = overlay.querySelector('#slip-image');
    if (img?.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
    overlay.remove();
  };
  overlay.querySelector('[data-close-slip]')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  try {
    const blob = await readPaymentSlipBlob(reg.paymentSlipId);
    const url = await createEnhancedSlipUrl(blob);
    const img = overlay.querySelector('#slip-image');
    img.src = url;
    img.classList.remove('hidden');
    overlay.querySelector('#slip-loading')?.remove();
  } catch (error) {
    console.error(error);
    const loading = overlay.querySelector('#slip-loading');
    if (loading) loading.innerHTML = `<div class="text-red-300">${escapeHtml(error.message || 'Could not load payment slip.')}</div>`;
  }
}

function bindAdminCardActions(regs) {
  document.querySelectorAll('[data-view-slip]').forEach((btn) => btn.addEventListener('click', async () => {
    const reg = regs.find(r => r.id === btn.dataset.viewSlip);
    if (reg) await showPaymentSlip(reg);
  }));

  document.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', async () => {
    const reg = regs.find(r => r.id === btn.dataset.approve);
    const card = btn.closest('[data-reg-card]');
    const input = card?.querySelector('[data-ticket-input]');
    const rawNumber = input?.value || '';

    let ticketNumber;
    try {
      ticketNumber = cleanTicketNumber(rawNumber);
    } catch (error) {
      input?.focus();
      toast(error.message || 'Enter a valid ticket number.', 'error');
      return;
    }

    if (!confirm(`Approve ${reg.fullName} and issue ticket ${ticketNumber}?`)) return;
    setBusy(btn, true, 'Issuing...');
    if (input) input.disabled = true;
    try {
      const result = await fn.approveRegistration({ uid: reg.uid, ticketNumber });
      toast(`Approved. Ticket ${result.data.ticketNumber} created.`, 'success');
      await loadAdminData();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Approval failed.', 'error');
      setBusy(btn, false);
      if (input) input.disabled = false;
    }
  }));

  document.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    const reg = regs.find(r => r.id === btn.dataset.reject);
    const reason = prompt(`Reason for rejecting ${reg.fullName}:`, 'Payment proof could not be verified.');
    if (!reason?.trim()) return;
    setBusy(btn, true, 'Rejecting...');
    try {
      await fn.rejectRegistration({ uid: reg.uid, reason: reason.trim() });
      toast('Registration rejected.', 'success');
      await loadAdminData();
    } catch (error) {
      toast(error.message || 'Reject failed.', 'error');
      setBusy(btn, false);
    }
  }));

  document.querySelectorAll('[data-resend]').forEach((btn) => btn.addEventListener('click', async () => {
    setBusy(btn, true, 'Sending...');
    try {
      await fn.resendTicketEmail({ uid: btn.dataset.resend });
      toast('Ticket email sent again.', 'success');
    } catch (error) {
      toast(error.message || 'Email resend failed.', 'error');
    } finally { setBusy(btn, false); }
  }));

  document.querySelectorAll('[data-admin-user]').forEach((btn) => btn.addEventListener('click', async () => {
    const makeAdmin = btn.dataset.adminValue === 'true';
    if (!confirm(`${makeAdmin ? 'Give' : 'Remove'} full admin access for this user?`)) return;
    setBusy(btn, true, 'Updating...');
    try {
      await fn.setUserAdmin({ uid: btn.dataset.adminUser, admin: makeAdmin });
      toast('Admin access updated.', 'success');
      await loadAdminData();
    } catch (error) {
      toast(error.message || 'Could not update admin access.', 'error');
      setBusy(btn, false);
    }
  }));
}

async function renderScanner() {
  if (!state.isAdmin) return renderHome();
  location.hash = '#scanner';
  app.innerHTML = pageShell(`
    <section class="mx-auto max-w-4xl py-4 sm:py-8">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><div class="text-xs font-extrabold tracking-[.18em] text-sky-300">ENTRY GATE</div><h1 class="mt-2 text-3xl font-black sm:text-5xl">QR Check-in Scanner</h1><p class="mt-2 text-sm text-slate-400">Each valid ticket becomes USED in one atomic verification.</p></div>
        <button data-action="admin" class="btn-ghost">Back to Admin</button>
      </div>
      <div class="grid gap-5 lg:grid-cols-[1fr_.8fr]">
        <div class="scanner-wrap glass rounded-[1.7rem] p-4"><div id="qr-reader" class="overflow-hidden rounded-2xl"></div></div>
        <div class="glass rounded-[1.7rem] p-5 sm:p-6">
          <div class="text-sm font-black">Last scan</div>
          <div id="scan-result" class="mt-4 rounded-2xl border border-white/[.06] bg-slate-950/30 p-5 text-sm text-slate-400">Camera is starting. Point it at an Aurelia QR code.</div>
          <form id="manual-scan" class="mt-5 space-y-3">
            <label class="text-xs font-bold text-slate-400">Manual QR payload / token</label>
            <input name="payload" class="field" placeholder="AURELIA2K26:..." />
            <button class="btn-ghost w-full" type="submit">Verify manually</button>
          </form>
        </div>
      </div>
    </section>`);
  bindGlobalActions();
  document.querySelector('#manual-scan')?.addEventListener('submit', (e) => {
    e.preventDefault();
    verifyScan(new FormData(e.currentTarget).get('payload'));
  });

  try {
    state.scanner = new Html5Qrcode('qr-reader');
    await state.scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => ({ width: Math.min(280, w * .75), height: Math.min(280, h * .75) }), aspectRatio: 1 },
      async (decodedText) => {
        await state.scanner.pause(true);
        await verifyScan(decodedText);
        setTimeout(() => state.scanner?.resume().catch(() => {}), 1800);
      },
      () => {}
    );
  } catch (error) {
    console.error(error);
    document.querySelector('#scan-result').innerHTML = `<div class="font-bold text-red-300">Camera unavailable</div><div class="mt-2">Allow camera permission or use manual verification below.</div>`;
  }
}

async function verifyScan(payload) {
  const resultBox = document.querySelector('#scan-result');
  try {
    const token = parseQrPayload(String(payload || '').trim());
    resultBox.innerHTML = `<div class="flex items-center gap-3"><div class="loader"></div><div>Verifying ticket...</div></div>`;
    const response = await fn.checkInTicket({ token });
    const d = response.data;
    if (d.status === 'checked_in') {
      resultBox.innerHTML = `<div class="text-xs font-black tracking-[.16em] text-emerald-300">ENTRY APPROVED</div><div class="mt-2 text-2xl font-black text-white">${escapeHtml(d.fullName)}</div><div class="mt-3 grid gap-2 text-xs"><div>Ticket: <strong class="text-yellow-100">${escapeHtml(d.ticketNumber)}</strong></div><div>${escapeHtml(d.batchLabel)} · ${escapeHtml(d.className)}</div></div>`;
    } else if (d.status === 'already_used') {
      resultBox.innerHTML = `<div class="text-xs font-black tracking-[.16em] text-red-300">ALREADY USED</div><div class="mt-2 text-2xl font-black text-white">${escapeHtml(d.fullName)}</div><div class="mt-3 text-sm text-red-200">Ticket ${escapeHtml(d.ticketNumber)} was previously checked in at ${escapeHtml(d.usedAtText || 'an earlier time')}.</div>`;
    }
  } catch (error) {
    console.error(error);
    resultBox.innerHTML = `<div class="text-xs font-black tracking-[.16em] text-red-300">INVALID TICKET</div><div class="mt-2 text-sm text-red-100">${escapeHtml(error.message || 'Ticket verification failed.')}</div>`;
  }
}

async function stopScanner() {
  if (!state.scanner) return;
  try { await state.scanner.stop(); } catch (_) {}
  try { state.scanner.clear(); } catch (_) {}
  state.scanner = null;
}

function bindGlobalActions() {
  document.querySelectorAll('[data-action="logout"]').forEach(el => el.addEventListener('click', () => signOut(auth)));
  document.querySelectorAll('[data-action="home"]').forEach(el => el.addEventListener('click', () => { location.hash = ''; renderHome(); }));
  document.querySelectorAll('[data-action="admin"]').forEach(el => el.addEventListener('click', renderAdmin));
  document.querySelectorAll('[data-action="scanner"]').forEach(el => el.addEventListener('click', renderScanner));
}

window.addEventListener('hashchange', () => {
  if (!state.user) return;
  if (location.hash === '#admin' && state.isAdmin) renderAdmin();
  else if (location.hash === '#scanner' && state.isAdmin) renderScanner();
  else renderHome();
});

renderLoading();
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.user = null;
    state.isAdmin = false;
    state.registration = null;
    state.unsubRegistration?.();
    stopScanner();
    renderLogin();
    return;
  }
  await prepareSignedInUser(user);
  if (location.hash === '#admin' && state.isAdmin) renderAdmin();
  else if (location.hash === '#scanner' && state.isAdmin) renderScanner();
});
