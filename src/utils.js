export const EVENT_NAME = 'The Aurelia 2K26';
export const EVENT_PRICE = 6000;

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

let heicLoaderPromise = null;
function loadHeicConverter() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (heicLoaderPromise) return heicLoaderPromise;
  heicLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
    script.async = true;
    script.onload = () => window.heic2any ? resolve(window.heic2any) : reject(new Error('HEIC converter did not load.'));
    script.onerror = () => reject(new Error('Could not load HEIC camera-photo support. Check your internet connection.'));
    document.head.appendChild(script);
  });
  return heicLoaderPromise;
}

async function normalizeMobileCameraFile(file) {
  if (!(file instanceof Blob) || file.size <= 0) throw new Error('The selected camera photo is empty. Please take the photo again.');
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  const isHeic = /image\/(heic|heif)/.test(type) || /\.(heic|heif)$/i.test(name);

  if (!isHeic) {
    if (type && !type.startsWith('image/')) throw new Error('Please select or take an image of the payment slip.');
    return file;
  }

  const heic2any = await loadHeicConverter();
  let converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.94 });
  if (Array.isArray(converted)) converted = converted[0];
  if (!(converted instanceof Blob)) throw new Error('Could not convert the camera photo. Please try again.');
  return new File([converted], `camera-slip-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

async function decodeImageSource(file) {
  // createImageBitmap is fast on Android/Chrome, but some camera-generated files
  // fail there even though the browser can display them. Fall back to <img>.
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw(ctx, width, height) { ctx.drawImage(bitmap, 0, 0, width, height); },
        close() { bitmap.close?.(); },
      };
    } catch (error) {
      console.warn('createImageBitmap could not decode camera photo; using image fallback.', error);
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Your browser could not read this camera photo. Try retaking it or selecting it from Gallery.'));
      el.src = url;
    });
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      draw(ctx, width, height) { ctx.drawImage(img, 0, 0, width, height); },
      close() {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(file, { maxWidth = 2200, maxHeight = 2200, quality = 0.84, targetBytes = 1.35 * 1024 * 1024 } = {}) {
  const normalized = await normalizeMobileCameraFile(file);
  const source = await decodeImageSource(normalized);
  let width = source.width;
  let height = source.height;
  if (!width || !height) {
    source.close?.();
    throw new Error('Could not read the photo dimensions. Please take the payment-slip photo again.');
  }

  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    source.close?.();
    throw new Error('Your browser could not prepare this camera photo. Please try again.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  source.draw(ctx, width, height);
  source.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error('Could not compress the camera photo. Please try again.');

  if (blob.size > targetBytes && (width > 1250 || height > 1250) && quality > 0.64) {
    return compressImage(new File([blob], 'compressed.webp', { type: 'image/webp' }), {
      maxWidth: Math.round(maxWidth * 0.88),
      maxHeight: Math.round(maxHeight * 0.88),
      quality: Math.max(0.64, quality - 0.06),
      targetBytes,
    });
  }
  return new File([blob], `payment-slip-${Date.now()}.webp`, { type: 'image/webp', lastModified: Date.now() });
}

export function parseQrPayload(text = '') {
  const prefix = 'AURELIA2K26:';
  if (!text.startsWith(prefix)) throw new Error('This is not an Aurelia 2K26 ticket QR.');
  const token = text.slice(prefix.length).trim();
  if (!token || token.length < 30) throw new Error('Invalid ticket token.');
  return token;
}
