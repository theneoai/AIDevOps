#!/usr/bin/env python3
"""
Dify Hybrid Encryption Helper

Replicates the encryption logic from register-tools.py for use by the Node.js DevKit.

Usage:
  python3 encrypt_helper.py <server_url> <public_key_pem>

Output:
  Base64-encoded encrypted string (written to stdout)
"""

import sys
import base64
from Crypto.Cipher import AES, PKCS1_OAEP
from Crypto.PublicKey import RSA
from Crypto.Random import get_random_bytes
from Crypto.Hash import SHA1


def encrypt_server_url(server_url: str, public_key_pem: str) -> str:
    """使用 Dify 的混合加密方案加密 server_url"""
    # 1. AES 加密
    aes_key = get_random_bytes(16)
    cipher_aes = AES.new(aes_key, AES.MODE_EAX)
    ciphertext, tag = cipher_aes.encrypt_and_digest(server_url.encode())

    # 2. RSA 加密 AES 密钥
    rsa_key = RSA.import_key(public_key_pem)
    cipher_rsa = PKCS1_OAEP.new(rsa_key, hashAlgo=SHA1)
    enc_aes_key = cipher_rsa.encrypt(aes_key)

    # 3. 构建混合载荷
    prefix = b"HYBRID:"
    payload = prefix + enc_aes_key + cipher_aes.nonce + tag + ciphertext

    # 4. Base64 编码
    return base64.b64encode(payload).decode()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python3 encrypt_helper.py <server_url> <public_key_pem>", file=sys.stderr)
        sys.exit(1)

    server_url = sys.argv[1]
    public_key_pem = sys.argv[2]

    try:
        result = encrypt_server_url(server_url, public_key_pem)
        print(result)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
