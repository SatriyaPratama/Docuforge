"""Best-effort content-addressed OCR result cache."""

import hashlib
import json
import os
import time
from typing import Any


class ResultCache:
    def __init__(self, directory: str, model_tag: str, ttl_seconds: int = 0, max_bytes: int = 0):
        self.directory = directory
        self.model_tag = model_tag
        self.ttl_seconds = ttl_seconds
        self.max_bytes = max_bytes

    def ensure_directory(self) -> None:
        os.makedirs(self.directory, exist_ok=True)

    def key(self, content_hash: str, page_indexes: list[int]) -> str:
        material = json.dumps({"model": self.model_tag, "content": content_hash, "pages": page_indexes}, sort_keys=True)
        return hashlib.sha256(material.encode()).hexdigest()

    def read(self, key: str) -> list[dict[str, Any]] | None:
        path = os.path.join(self.directory, f"{key}.json")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def write(self, key: str, pages: list[dict[str, Any]]) -> None:
        path = os.path.join(self.directory, f"{key}.json")
        temporary = f"{path}.tmp"
        try:
            with open(temporary, "w", encoding="utf-8") as handle:
                json.dump(pages, handle)
            os.replace(temporary, path)
        except OSError:
            try:
                os.remove(temporary)
            except OSError:
                pass

    def prune(self) -> None:
        if not self.ttl_seconds and not self.max_bytes:
            return
        now = time.time()
        entries: list[os.DirEntry[str]] = []
        try:
            for entry in os.scandir(self.directory):
                if not entry.is_file() or not entry.name.endswith(".json"):
                    continue
                if self.ttl_seconds and entry.stat().st_mtime < now - self.ttl_seconds:
                    try:
                        os.remove(entry.path)
                    except OSError:
                        pass
                else:
                    entries.append(entry)
            if self.max_bytes:
                sized = sorted(((entry.stat().st_mtime, entry.stat().st_size, entry.path) for entry in entries), key=lambda item: item[0])
                total = sum(size for _, size, _ in sized)
                for _, size, path in sized:
                    if total <= self.max_bytes:
                        break
                    try:
                        os.remove(path)
                        total -= size
                    except OSError:
                        pass
        except OSError:
            return
