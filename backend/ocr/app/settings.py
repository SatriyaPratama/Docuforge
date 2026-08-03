"""Immutable runtime configuration for the OCR service."""

from dataclasses import dataclass
import os


def int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return default


def float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    max_upload_bytes: int = 20 * 1024 * 1024
    max_pages: int = 50
    target_long_edge_px: int = 2048
    result_cache_dir: str = "/data/cache/results"
    document_dir: str = "/data/documents"
    document_ttl_seconds: int = 3600
    model_tag: str = "surya-ocr-2-boxes-v1"
    table_items_enabled: bool = True
    inference_backend: str = "auto"
    inference_concurrency: int = 1
    max_queue_depth: int = 4
    chunk_size: int = 4
    device: str = "cpu"
    inference_health_url: str = ""
    inference_ready_timeout_seconds: float = 30.0
    inference_recovery_attempts: int = 1
    inference_recovery_backoff_seconds: float = 1.0
    result_cache_ttl_seconds: int = 0
    result_cache_max_bytes: int = 0
    cleanup_interval_seconds: int = 60

    @classmethod
    def from_environment(cls) -> "Settings":
        backend = (os.getenv("SURYA_INFERENCE_BACKEND", "auto").strip().lower() or "auto")
        max_pages = max(1, int_env("MAX_PAGES", 50))
        concurrency = max(1, int_env("INFERENCE_CONCURRENCY", 4 if backend == "vllm" else 1))
        return cls(
            max_pages=max_pages,
            target_long_edge_px=max(1, int_env("RENDER_LONG_EDGE_PX", 2048)),
            result_cache_dir=os.getenv("RESULT_CACHE_DIR", "/data/cache/results"),
            document_dir=os.getenv("DOCUMENT_DIR", "/data/documents"),
            document_ttl_seconds=max(int_env("DOCUMENT_TTL_SECONDS", 3600), 60),
            table_items_enabled=os.getenv("TABLE_ITEMS_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"},
            inference_backend=backend,
            inference_concurrency=concurrency,
            max_queue_depth=max(int_env("MAX_QUEUE_DEPTH", 4), concurrency + 2),
            chunk_size=max(1, min(max_pages, int_env("CHUNK_SIZE", 25 if backend == "vllm" else 4))),
            device=(os.getenv("DOCUFORGE_DEVICE", "cpu").strip().lower() or "cpu"),
            inference_health_url=os.getenv("SURYA_INFERENCE_HEALTH_URL", "").strip(),
            inference_ready_timeout_seconds=max(float_env("INFERENCE_READY_TIMEOUT_SECONDS", 30.0), 5.0),
            inference_recovery_attempts=max(int_env("INFERENCE_RECOVERY_ATTEMPTS", 1), 0),
            inference_recovery_backoff_seconds=max(float_env("INFERENCE_RECOVERY_BACKOFF_SECONDS", 1.0), 0.25),
            result_cache_ttl_seconds=max(int_env("RESULT_CACHE_TTL_SECONDS", 0), 0),
            result_cache_max_bytes=max(int_env("RESULT_CACHE_MAX_BYTES", 0), 0),
            cleanup_interval_seconds=max(int_env("CLEANUP_INTERVAL_SECONDS", 60), 1),
        )
