import { Bytes, doc, getDoc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { db } from './firebase.js';

const CHUNK_BYTES = 700 * 1024; // comfortably below Firestore's 1 MiB document limit
const MAX_CHUNKS = 8;

export async function savePaymentSlipToFirestore(uid, file) {
  if (!uid) throw new Error('Missing user ID.');
  const type = String(file?.type || '').toLowerCase();
  const isImage = type.startsWith('image/');
  const isPdf = type === 'application/pdf' || String(file?.name || '').toLowerCase().endsWith('.pdf');
  if (!isImage && !isPdf) throw new Error('Payment proof must be an image or PDF.');
  if (file.size > 4 * 1024 * 1024) throw new Error('Payment proof must be 4 MB or smaller.');

  const buffer = new Uint8Array(await file.arrayBuffer());
  const chunkCount = Math.ceil(buffer.byteLength / CHUNK_BYTES);
  if (chunkCount < 1 || chunkCount > MAX_CHUNKS) {
    throw new Error('Payment proof is too large for Firestore. Please keep the image/PDF under 4 MB.');
  }

  const slipId = `${uid}_${crypto.randomUUID()}`;
  await setDoc(doc(db, 'paymentSlips', slipId), {
    ownerUid: uid,
    mimeType: file.type || (String(file.name || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/webp'),
    byteLength: buffer.byteLength,
    chunkCount,
    originalName: String(file.name || 'payment-slip.webp').slice(0, 120),
    createdAt: serverTimestamp(),
  });

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHUNK_BYTES;
    const end = Math.min(buffer.byteLength, start + CHUNK_BYTES);
    await setDoc(doc(db, 'paymentSlips', slipId, 'chunks', String(index).padStart(3, '0')), {
      index,
      bytes: Bytes.fromUint8Array(buffer.slice(start, end)),
    });
  }

  return { slipId, byteLength: buffer.byteLength, chunkCount, mimeType: file.type || (String(file.name || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/webp') };
}

export async function readPaymentSlipBlob(slipId) {
  if (!slipId) throw new Error('Payment slip reference is missing.');
  const metaSnap = await getDoc(doc(db, 'paymentSlips', slipId));
  if (!metaSnap.exists()) throw new Error('Payment slip was not found.');
  const meta = metaSnap.data();
  const chunkCount = Number(meta.chunkCount || 0);
  if (!chunkCount || chunkCount > MAX_CHUNKS) throw new Error('Payment slip metadata is invalid.');

  const chunks = [];
  let total = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const chunkSnap = await getDoc(doc(db, 'paymentSlips', slipId, 'chunks', String(index).padStart(3, '0')));
    if (!chunkSnap.exists()) throw new Error(`Payment slip chunk ${index + 1} is missing.`);
    const bytes = chunkSnap.data().bytes?.toUint8Array?.();
    if (!bytes) throw new Error('Payment slip data is corrupted.');
    chunks.push(bytes);
    total += bytes.byteLength;
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const bytes of chunks) {
    joined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return new Blob([joined], { type: meta.mimeType || 'image/webp' });
}

export async function createEnhancedSlipUrl(blob) {
  if (blob?.type === 'application/pdf') return URL.createObjectURL(blob);
  const bitmap = await createImageBitmap(blob);
  const upscale = Math.min(1.35, 3400 / Math.max(bitmap.width, bitmap.height));
  const scale = Math.max(1, upscale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'contrast(1.04) saturate(1.015)';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const enhanced = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  return URL.createObjectURL(enhanced || blob);
}
