/**
 * Dify Hybrid Encryption
 *
 * Replicates the Python implementation from register-tools.py.
 * Uses a Python helper script since Node.js does not support AES-EAX mode.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Encrypt a server URL using Dify's hybrid encryption scheme.
 *
 * @param serverUrl - The URL to encrypt
 * @param publicKeyPem - RSA public key in PEM format
 * @returns Base64-encoded encrypted string with HYBRID: prefix
 */
export function encryptServerUrl(serverUrl: string, publicKeyPem: string): string {
  const scriptPath = path.join(__dirname, '../../scripts/encrypt_helper.py');

  try {
    const result = execFileSync('python3', [scriptPath, serverUrl, publicKeyPem], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return result.trim();
  } catch (error) {
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate SHA-256 hash of a string.
 */
export function sha256(input: string): string {
  return require('crypto').createHash('sha256').update(input).digest('hex');
}
