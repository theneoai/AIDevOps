/**
 * Crypto Module Tests
 */

import { encryptServerUrl, sha256 } from '../src/registry/crypto';
import { generateKeyPairSync } from 'crypto';
import { execFileSync } from 'child_process';

function generateTestKey(): string {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return publicKey as string;
}

/** Returns true when the Python pycryptodome library is available */
function pycryptoAvailable(): boolean {
  try {
    execFileSync('python3', ['-c', 'from Crypto.Cipher import AES'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const maybeDescribeEncrypt = pycryptoAvailable() ? describe : describe.skip;

describe('sha256', () => {
  it('should generate correct SHA-256 hash', () => {
    const hash = sha256('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should generate different hashes for different inputs', () => {
    const hash1 = sha256('hello');
    const hash2 = sha256('world');
    expect(hash1).not.toBe(hash2);
  });
});

maybeDescribeEncrypt('encryptServerUrl', () => {
  let publicKey: string;

  beforeAll(() => {
    publicKey = generateTestKey();
  });

  it('should encrypt a server URL', () => {
    const encrypted = encryptServerUrl('http://localhost:3000/sse', publicKey);
    expect(encrypted).toBeTruthy();
    expect(encrypted.length).toBeGreaterThan(0);
    // Should be base64 encoded
    expect(Buffer.from(encrypted, 'base64').toString('base64')).toBe(encrypted);
  });

  it('should produce different ciphertexts for same input (random nonce)', () => {
    const encrypted1 = encryptServerUrl('http://localhost:3000/sse', publicKey);
    const encrypted2 = encryptServerUrl('http://localhost:3000/sse', publicKey);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should throw on invalid public key', () => {
    expect(() => encryptServerUrl('http://test.com', 'invalid-key')).toThrow();
  });
});
