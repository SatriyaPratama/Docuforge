"""Temporary, private document-handle storage."""

from dataclasses import dataclass
import hashlib
import json
import os
import re
import time
from uuid import UUID, uuid4

from fastapi import HTTPException, UploadFile


DOCUMENT_ID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)


@dataclass(frozen=True)
class StoredDocument:
    document_id: str
    path: str
    content_sha256: str
    page_count: int
    size_bytes: int

    def public_metadata(self) -> dict[str, object]:
        return {"document_id": self.document_id, "content_sha256": self.content_sha256, "page_count": self.page_count, "size_bytes": self.size_bytes}


class DocumentStore:
    def __init__(self, directory: str, ttl_seconds: int, max_upload_bytes: int):
        self.directory = directory
        self.ttl_seconds = ttl_seconds
        self.max_upload_bytes = max_upload_bytes

    def ensure_directory(self) -> None:
        os.makedirs(self.directory, exist_ok=True)

    def _paths(self, document_id: str) -> tuple[str, str]:
        if not DOCUMENT_ID_PATTERN.fullmatch(document_id):
            raise HTTPException(status_code=400, detail="Invalid document_id")
        canonical = str(UUID(document_id))
        return os.path.join(self.directory, f"{canonical}.bin"), os.path.join(self.directory, f"{canonical}.json")

    async def store_upload(self, file: UploadFile, page_counter, image_validator) -> StoredDocument:
        self.ensure_directory()
        document_id = str(uuid4())
        path, metadata_path = self._paths(document_id)
        temp_path = f"{path}.{uuid4().hex}.tmp"
        digest = hashlib.sha256()
        size = 0
        try:
            with open(temp_path, "wb") as handle:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.max_upload_bytes:
                        raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit.")
                    digest.update(chunk)
                    handle.write(chunk)
            if not size:
                raise HTTPException(status_code=400, detail="Uploaded file is empty.")
            # Validation operates against the staged file so a handle request
            # never needs a second whole-file allocation.
            with open(temp_path, "rb") as handle:
                magic = handle.read(5)
            if magic == b"%PDF-":
                page_count = page_counter(temp_path)
            else:
                image_validator(temp_path)
                page_count = 1
            os.replace(temp_path, path)
            metadata = StoredDocument(document_id, path, digest.hexdigest(), page_count, size)
            temp_metadata = f"{metadata_path}.{uuid4().hex}.tmp"
            with open(temp_metadata, "w", encoding="utf-8") as handle:
                json.dump(metadata.public_metadata(), handle)
            os.replace(temp_metadata, metadata_path)
            return metadata
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Failed to decode the document.") from exc
        finally:
            try:
                os.remove(temp_path)
            except OSError:
                pass

    def load(self, document_id: str) -> StoredDocument:
        path, metadata_path = self._paths(document_id)
        try:
            with open(metadata_path, "r", encoding="utf-8") as handle:
                metadata = json.load(handle)
            now = time.time()
            os.utime(path, (now, now))
            os.utime(metadata_path, (now, now))
            return StoredDocument(str(metadata["document_id"]), path, str(metadata["content_sha256"]), int(metadata["page_count"]), int(metadata["size_bytes"]))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Document has expired or was not found.") from exc
        except (OSError, ValueError, TypeError, KeyError) as exc:
            raise HTTPException(status_code=500, detail="Stored document could not be read.") from exc

    def delete(self, document_id: str) -> None:
        for path in self._paths(document_id):
            try:
                os.remove(path)
            except FileNotFoundError:
                continue

    def cleanup(self) -> None:
        self.ensure_directory()
        cutoff = time.time() - self.ttl_seconds
        try:
            for entry in os.scandir(self.directory):
                try:
                    if entry.is_file() and entry.stat().st_mtime < cutoff:
                        os.remove(entry.path)
                except OSError:
                    continue
        except OSError:
            return
