import { deflateSync, Inflate, strToU8, strFromU8 } from '../vendor/fflate/codec.js';

export const MAX_SCENE_VECTOR_BYTES = 2 * 1024 * 1024;
export const MAX_SCORE_VECTOR_BYTES = 64 * 1024 * 1024;

export function packVectors(vectors) {
  const raw = strToU8(JSON.stringify(vectors));
  if (raw.length > MAX_SCENE_VECTOR_BYTES) throw new Error('A score composition is too large.');
  const packed = deflateSync(raw, { level: 6 });
  let binary = '';
  for (let i = 0; i < packed.length; i += 8192) binary += String.fromCharCode(...packed.subarray(i, i + 8192));
  return { codec: 'deflate-json', bytes: raw.length, data: btoa(binary) };
}

export function unpackVectors(record) {
  const vectors = record.vectors;
  if (vectors?.codec !== 'deflate-json' || !Number.isInteger(vectors.bytes) || vectors.bytes < 1
    || vectors.bytes > MAX_SCENE_VECTOR_BYTES || typeof vectors.data !== 'string'
    || vectors.data.length > MAX_SCENE_VECTOR_BYTES * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(vectors.data)) {
    throw new Error('Invalid score vectors.');
  }
  const binary = atob(vectors.data), packed = Uint8Array.from(binary, c => c.charCodeAt(0));
  const raw = new Uint8Array(vectors.bytes);
  let offset = 0, ended = false;
  // Decode small input chunks so a dishonest expanded-size field cannot cause
  // an unbounded allocation before the per-composition limit is enforced.
  const stream = new Inflate((chunk, final) => {
    if (offset + chunk.length > raw.length) throw new Error('Score vector size exceeds its declaration.');
    raw.set(chunk, offset); offset += chunk.length; ended = final;
  });
  for (let i = 0; i < packed.length; i += 1024) stream.push(packed.subarray(i, i + 1024), i + 1024 >= packed.length);
  if (!ended || offset !== raw.length) throw new Error('Truncated score vectors.');
  return JSON.parse(strFromU8(raw));
}
