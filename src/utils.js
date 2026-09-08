export const EVENT_NAME = 'The Aurelia 2K26';
export const EVENT_PRICE = 5500;

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatMoney(value) {
  return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo' }).format(date);
}

export function toast(message, type = 'info') {
  const root = document.querySelector('#toast-root');
  if (!root) return;
  const el = document.createElement('div');
  const tone = type === 'error'
    ? 'border-red-400/30 bg-red-950/90 text-red-100'
    : type === 'success'
      ? 'border-emerald-400/30 bg-emerald-950/90 text-emerald-100'
      : 'border-sky-400/30 bg-slate-950/90 text-slate-100';
  el.className = `max-w-sm rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${tone}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function setBusy(button, busy, label = 'Please wait...') {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="inline-flex items-center gap-2"><span class="loader !h-4 !w-4 !border-2"></span>${label}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}

export async function compressImage(file, { maxWidth = 2200, maxHeight = 2200, quality = 0.84, targetBytes = 1.35 * 1024 * 1024 } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('Please select an image file.');
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new Error('Could not compress the image.');
  if (blob.size > targetBytes && (width > 1250 || height > 1250) && quality > 0.64) {
    return compressImage(new File([blob], 'compressed.webp', { type: 'image/webp' }), {
      maxWidth: Math.round(maxWidth * 0.88),
      maxHeight: Math.round(maxHeight * 0.88),
      quality: Math.max(0.64, quality - 0.06),
      targetBytes,
    });
  }
  return new File([blob], `payment-slip-${Date.now()}.webp`, { type: 'image/webp' });
}

export function parseQrPayload(text = '') {
  const prefix = 'AURELIA2K26:';
  if (!text.startsWith(prefix)) throw new Error('This is not an Aurelia 2K26 ticket QR.');
  const token = text.slice(prefix.length).trim();
  if (!token || token.length < 30) throw new Error('Invalid ticket token.');
  return token;
}
