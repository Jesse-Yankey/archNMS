"""Encrypts device credentials at rest (Fernet). Secrets are never returned by the API."""
import json, os
from pathlib import Path
from cryptography.fernet import Fernet

KEY_FILE = Path(os.environ.get("ARCH_KEY_FILE", "arch.key"))
_f = None

def _fernet() -> Fernet:
    global _f
    if _f: return _f
    key = os.environ.get("ARCH_SECRET_KEY", "").encode()
    if not key:
        try:   # create once, owner-readable only
            fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f: f.write(Fernet.generate_key())
        except FileExistsError:
            pass
        key = KEY_FILE.read_bytes().strip()
    _f = Fernet(key)
    return _f

def encrypt_json(obj: dict) -> str:
    return _fernet().encrypt(json.dumps(obj).encode()).decode()

def decrypt_json(token: str | None) -> dict:
    return json.loads(_fernet().decrypt(token.encode())) if token else {}
