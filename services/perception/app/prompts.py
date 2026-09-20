from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from bson import ObjectId

from .detector import Prompt, Prompts

if TYPE_CHECKING:
    from .store import ObservationStore


@dataclass(frozen=True, slots=True)
class CachedPrompts:
    prompts: Prompts
    version: int
    loaded_at: float


class PromptCache:
    """One entry per wearer: the detector class prompts built from active items."""

    def __init__(self, store: ObservationStore, ttl_seconds: float) -> None:
        self._store = store
        self._ttl_seconds = ttl_seconds
        self._entries: dict[ObjectId, CachedPrompts] = {}
        self._lock = asyncio.Lock()

    async def get(self, patient_id: ObjectId) -> CachedPrompts:
        async with self._lock:
            current = self._entries.get(patient_id)
            if current is not None and time.monotonic() - current.loaded_at < self._ttl_seconds:
                return current
            return await self._load(patient_id, (current.version + 1) if current else 1)

    async def reload(self, patient_id: ObjectId, version: int | None = None) -> CachedPrompts:
        async with self._lock:
            current = self._entries.get(patient_id)
            next_version = max((current.version + 1) if current else 1, version or 0)
            return await self._load(patient_id, next_version)

    async def _load(self, patient_id: ObjectId, version: int) -> CachedPrompts:
        items = await self._store.active_items(patient_id)
        prompts = tuple(Prompt(str(item.item_id), item.name, text) for item in items for text in item.prompts)
        entry = CachedPrompts(prompts, version, time.monotonic())
        self._entries[patient_id] = entry
        return entry

    def versions(self) -> dict[str, int]:
        return {str(patient_id): entry.version for patient_id, entry in self._entries.items()}
