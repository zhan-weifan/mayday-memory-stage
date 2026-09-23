import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2];
const photoPath = process.argv[3];
if (!sourcePath) throw Error('用法：node tools/prepare-example-memory.mjs <记忆文件.still> [原始照片.jpg]');

const source = await readFile(sourcePath);
if (source.length < 12 || source.readUInt32LE(0) !== 0x4c4c5453 || source.readUInt32LE(4) !== 1) {
  throw Error('输入文件不是受支持的 Still 记忆文件。');
}
const headerBytes = source.readUInt32LE(8);
if (headerBytes < 2 || headerBytes > 100000 || 12 + headerBytes > source.length) throw Error('记忆文件头无效。');
const meta = JSON.parse(source.subarray(12, 12 + headerBytes).toString('utf8'));
const photoStart = 12 + headerBytes;
const modelStart = photoStart + meta.photoBytes;
if (!Number.isSafeInteger(meta.photoBytes) || meta.photoBytes < 1 || modelStart > source.length ||
    source.length - modelStart !== meta.modelBytes || meta.modelBytes % 64 !== 0 || meta.photoType !== 'image/jpeg') {
  throw Error('记忆文件中的照片或模型长度无效。');
}

const photo = source.subarray(photoStart, modelStart);
if (photoPath) {
  const supplied = await readFile(photoPath);
  const hash = data => createHash('sha256').update(data).digest('hex');
  if (hash(photo) !== hash(supplied)) throw Error('单独提供的照片与记忆文件内嵌照片不一致。');
}

const model = source.subarray(modelStart);
const alignedModel = model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength);
const values = new Float32Array(alignedModel);
for (const value of values) if (!Number.isFinite(value)) throw Error('记忆模型包含非有限数值。');
const count = values.length / 16;
const mobileCount = Math.min(count, 65536);
const mobileValues = new Float32Array(mobileCount * 16);
for (let out = 0; out < mobileCount; out++) {
  const input = Math.floor((out + 0.5) * count / mobileCount);
  mobileValues.set(values.subarray(input * 16, input * 16 + 16), out * 16);
}

await Promise.all([
  writeFile(resolve(root, 'demo.jpg'), photo),
  writeFile(resolve(root, 'demo.memorygs'), model),
  writeFile(resolve(root, 'demo-mobile.memorygs'), Buffer.from(mobileValues.buffer))
]);
console.log(JSON.stringify({
  source: sourcePath,
  photoBytes: photo.length,
  desktopModelBytes: model.length,
  desktopPoints: count,
  mobileModelBytes: mobileValues.byteLength,
  mobilePoints: mobileCount
}, null, 2));
