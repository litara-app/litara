import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * Computes KOReader's partial MD5 hash used to identify documents.
 *
 * Algorithm (from KOReader's util.partialMD5 / frontend/util.lua):
 *   step = size = 1024
 *   read 1024 bytes at offset 0
 *   for i = 0..10: read 1024 bytes at offset (4^i) * 1024
 *   stop early if read returns 0 bytes (past EOF)
 *
 * Seek offsets: 0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
 *               16777216, 67108864, 268435456, 1073741824
 */
export function computeKoReaderHash(filePath: string): string {
  const size = 1024;
  const step = 1024;
  const hash = crypto.createHash('md5');
  const buf = Buffer.allocUnsafe(size);
  const fd = fs.openSync(filePath, 'r');
  try {
    const initial = fs.readSync(fd, buf, 0, size, 0);
    if (initial > 0) hash.update(buf.subarray(0, initial));
    for (let i = 0; i <= 10; i++) {
      const offset = Math.pow(4, i) * step;
      const bytesRead = fs.readSync(fd, buf, 0, size, offset);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
