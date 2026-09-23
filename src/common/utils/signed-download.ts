import { createHmac, timingSafeEqual } from 'node:crypto';

export function createSignedDownloadQuery(jobId: string, expiresSeconds: number, secret: string): string {
  const expires = Math.floor(Date.now() / 1000) + expiresSeconds;
  const sig = sign(jobId, expires, secret);
  return `expires=${expires}&sig=${sig}`;
}

export function verifySignedDownload(
  jobId: string,
  expiresRaw: unknown,
  sigRaw: unknown,
  secret: string,
): boolean {
  const expires = Number(expiresRaw);
  const sig = typeof sigRaw === 'string' ? sigRaw : '';
  if (!Number.isFinite(expires) || expires * 1000 < Date.now() || !/^[a-f0-9]{64}$/.test(sig)) {
    return false;
  }

  const expected = sign(jobId, expires, secret);
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(sig, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(jobId: string, expires: number, secret: string): string {
  return createHmac('sha256', secret).update(`${jobId}.${expires}`).digest('hex');
}
