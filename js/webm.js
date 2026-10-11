// Add Duration to Chrome's streaming WebM header, without copying the take's
// large media payload. IDs and timestamp units follow the Matroska specification:
// https://www.matroska.org/technical/elements.html
function vint(bytes, start, identifier = false) {
  if (start >= bytes.length || !bytes[start]) throw new Error('Invalid EBML header');
  let width = 1, marker = 0x80;
  while (!(bytes[start] & marker)) { width++; marker >>= 1; }
  if (width > 8 || start + width > bytes.length) throw new Error('Truncated EBML header');
  let value = BigInt(identifier ? bytes[start] : bytes[start] & (marker - 1));
  for (let i = 1; i < width; i++) value = (value << 8n) | BigInt(bytes[start + i]);
  const unknown = !identifier && value === (1n << BigInt(width * 7)) - 1n;
  return { width, value: unknown ? Infinity : Number(value), unknown };
}
function element(bytes, start) {
  const id = vint(bytes, start, true), sizeStart = start + id.width;
  const size = vint(bytes, sizeStart), data = sizeStart + size.width;
  return { start, id: id.value, sizeStart, sizeWidth: size.width, data, size: size.value,
    end: data + size.value, unknown: size.unknown };
}
function sizeBytes(value, width = 1) {
  let remaining = BigInt(value);
  while (remaining >= (1n << BigInt(width * 7)) - 1n) width++;
  const result = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) { result[i] = Number(remaining & 255n); remaining >>= 8n; }
  result[0] |= 1 << (8 - width);
  return result;
}

export async function fixWebmDuration(blob, seconds) {
  if (!blob.type.includes('webm') || !(seconds > 0)) return blob;
  // Info and Tracks are in the small header. Keep all clusters in Blob slices.
  const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  let segment = null, info = null, hasSeekHead = false;
  try {
    for (let p = 0; p < bytes.length;) {
      const node = element(bytes, p);
      if (node.id === 0x18538067) { segment = node; break; }
      if (!Number.isFinite(node.end) || node.end <= p) return blob;
      p = node.end;
    }
    if (!segment) return blob;
    for (let p = segment.data; p < bytes.length;) {
      const node = element(bytes, p);
      if (node.id === 0x1549A966) info = node;
      if (node.id === 0x114D9B74 || node.id === 0x1C53BB6B) hasSeekHead = true;
      if (node.id === 0x1F43B675 || !Number.isFinite(node.end) || node.end > bytes.length) break;
      if (node.end <= p) return blob;
      p = node.end;
    }
    if (!info || info.unknown || info.end > bytes.length) return blob;
    let duration = null, scale = 1000000, crc = false;
    for (let p = info.data; p < info.end;) {
      const node = element(bytes, p);
      if (node.end > info.end || node.end <= p) return blob;
      if (node.id === 0x4489) duration = node;
      if (node.id === 0xBF) crc = true;
      if (node.id === 0x2AD7B1) {
        scale = 0;
        for (let i = node.data; i < node.end; i++) scale = scale * 256 + bytes[i];
      }
      p = node.end;
    }
    if (!scale || crc) return blob;
    const ticks = seconds * 1000000000 / scale;
    if (duration && (duration.size === 4 || duration.size === 8)) {
      const view = new DataView(bytes.buffer);
      const existing = duration.size === 8 ? view.getFloat64(duration.data) : view.getFloat32(duration.data);
      if (existing > 0) return blob;
      if (duration.size === 8) view.setFloat64(duration.data, ticks); else view.setFloat32(duration.data, ticks);
      return new Blob([bytes, blob.slice(bytes.length)], { type: blob.type });
    }
    // An indexed, finite file may contain offset-based cues. Do not shift those.
    // Chrome MediaRecorder emits an unindexed, unknown-sized streaming segment.
    if (duration || !segment.unknown || hasSeekHead) return blob;
    const durationBytes = new Uint8Array(11);
    durationBytes.set([0x44, 0x89, 0x88]);
    new DataView(durationBytes.buffer).setFloat64(3, ticks);
    return new Blob([
      bytes.subarray(0, info.sizeStart), sizeBytes(info.size + 11, info.sizeWidth),
      bytes.subarray(info.data, info.end), durationBytes, blob.slice(info.end)
    ], { type: blob.type });
  } catch { return blob; }
}
