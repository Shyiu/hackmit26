from __future__ import annotations

import numpy as np
from cryptography.fernet import Fernet


def encrypt_embedding(embedding: np.ndarray, fernet: Fernet) -> bytes:
    array = np.asarray(embedding, dtype=np.float32)
    return fernet.encrypt(array.tobytes())


def decrypt_embedding(payload: bytes, fernet: Fernet, dim: int | None = None) -> np.ndarray:
    data = np.frombuffer(fernet.decrypt(payload), dtype=np.float32).copy()
    if dim is not None and len(data) != dim:
        raise ValueError(f"embedding dimension mismatch: expected {dim}, got {len(data)}")
    return data
