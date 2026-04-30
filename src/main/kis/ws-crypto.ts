import { createDecipheriv } from 'node:crypto';

export function decryptAes256CbcBase64(key: string, iv: string, cipherText: string): string {
  const decipher = createDecipheriv(
    'aes-256-cbc',
    Buffer.from(key, 'utf8'),
    Buffer.from(iv, 'utf8'),
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
