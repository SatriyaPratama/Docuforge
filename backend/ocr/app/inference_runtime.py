"""Inference failure classification, telemetry, recovery state, and admission."""

from contextlib import asynccontextmanager
import asyncio
import hashlib
import json
import logging
import re
import time
from typing import Any


logger = logging.getLogger("surya-ocr")

CUDA_EVENTS = {
    "cuda_illegal_instruction",
    "cuda_illegal_memory_access",
    "cuda_device_assert",
    "cuda_launch_failure",
    "cuda_runtime_error",
}

_CUDA_FAILURES: tuple[tuple[str, str], ...] = (
    ("illegal instruction", "cuda_illegal_instruction"),
    ("illegal memory access", "cuda_illegal_memory_access"),
    ("device-side assert", "cuda_device_assert"),
    ("unspecified launch failure", "cuda_launch_failure"),
    ("launch failure", "cuda_launch_failure"),
    ("misaligned address", "cuda_runtime_error"),
    ("invalid configuration argument", "cuda_runtime_error"),
)


class InferenceServiceError(RuntimeError):
    def __init__(self, detail: str, event: str):
        super().__init__(detail)
        self.detail = detail
        self.event = event


def _failure_context(exc: Exception) -> tuple[str, str, dict[str, Any]]:
    message = str(exc).lower()
    cuda_error_code: str | None = None
    event: str | None = None

    for marker, candidate in _CUDA_FAILURES:
        if marker in message:
            event = candidate
            cuda_error_code = marker.replace(" ", "_").replace("-", "_")
            break

    # llama.cpp can emit only the generic "CUDA error" at the synchronization
    # point. Treat it as a retryable runtime failure while preserving the
    # original message only as a one-way fingerprint for diagnostics.
    if event is None and any(marker in message for marker in (
        "cuda error",
        "cuda runtime",
        "cudastreamsynchronize",
        "device lost",
        "cuda driver",
        "cuda kernel",
    )):
        event = "cuda_runtime_error"
        cuda_error_code = "runtime_error"

    if any(token in message for token in ("out of memory", "failed to allocate", "allocation failed", "insufficient memory")):
        detail, event = (
            "GPU memory limit reached while processing this page. Try a smaller page range or restart the GPU OCR stack.",
            "gpu_oom",
        )
    elif event in CUDA_EVENTS:
        detail = (
            "The GPU OCR server reported a CUDA kernel failure while processing this page. "
            "The stack is recovering; retry the page after it becomes ready."
        )
    elif "failed to parse grammar" in message or "unknown escape" in message:
        detail, event = (
            "The OCR server rejected a structured-output grammar. Guided layout has been disabled for this GPU profile; restart the OCR stack if this persists.",
            "grammar_error",
        )
    elif any(token in message for token in ("loading model", "service unavailable", "connection refused", "connecterror", "readerror", "server disconnected", "temporarily unavailable", "status code: 503")):
        detail, event = (
            "The GPU OCR server is restarting or still loading its model. Please retry when the OCR service is ready.",
            "inference_unavailable",
        )
    else:
        detail, event = "OCR inference failed.", "inference_failed"

    normalized = re.sub(r"\s+", " ", str(exc).strip().lower())
    context = {
        "cuda_error_code": cuda_error_code,
        "message_fingerprint": hashlib.sha256(normalized.encode("utf-8", "replace")).hexdigest()[:16] if normalized else None,
        "exception_type": type(exc).__name__,
    }
    return detail, event, context


def inference_failure(exc: Exception) -> tuple[str, str]:
    detail, event, _context = _failure_context(exc)
    return detail, event


def inference_failure_context(exc: Exception) -> tuple[str, str, dict[str, Any]]:
    """Return safe client text plus non-sensitive diagnostic metadata."""
    return _failure_context(exc)


def initial_inference_status() -> dict[str, Any]:
    return {
        "state": "starting",
        "health_url_configured": False,
        "consecutive_failures": 0,
        "detected_recoveries": 0,
        "sidecar_generation": 0,
        "sidecar_unready_observed": False,
        "last_event": None,
        "last_detail": None,
        "last_event_at": None,
        "last_ready_at": None,
        "last_request_id": None,
        "last_page_indexes": None,
        "last_attempt": None,
        "last_error_code": None,
        "last_message_fingerprint": None,
        "last_exception_type": None,
    }


def record_inference_event(
    state: Any,
    event: str,
    detail: str | None = None,
    **context: Any,
) -> None:
    status = state.inference_status
    # Keep health responses backward-compatible while allowing a process
    # started with an older status shape to receive new telemetry fields.
    for key, value in initial_inference_status().items():
        status.setdefault(key, value)
    status["last_event"] = event
    status["last_detail"] = detail
    status["last_event_at"] = time.time()
    if "request_id" in context:
        status["last_request_id"] = context["request_id"]
    if "page_indexes" in context:
        status["last_page_indexes"] = list(context["page_indexes"] or [])
    if "attempt" in context:
        status["last_attempt"] = context["attempt"]
    if "cuda_error_code" in context:
        status["last_error_code"] = context["cuda_error_code"]
    if "message_fingerprint" in context:
        status["last_message_fingerprint"] = context["message_fingerprint"]
    if "exception_type" in context:
        status["last_exception_type"] = context["exception_type"]
    if event == "inference_ready":
        if status["sidecar_unready_observed"] and status["last_ready_at"] is not None:
            status["detected_recoveries"] += 1
            status["sidecar_generation"] += 1
        status["sidecar_unready_observed"] = False
        status.update(state="ready", consecutive_failures=0, last_ready_at=status["last_event_at"])
    elif event == "inference_waiting":
        status["state"] = "waiting"
        status["sidecar_unready_observed"] = True
    else:
        status["state"] = "unavailable" if event == "inference_unavailable" else "degraded"
        status["consecutive_failures"] += 1
        if event == "inference_unavailable":
            status["sidecar_unready_observed"] = True


def inference_http_status(event: str) -> int:
    return 503 if event in {"gpu_oom", "inference_unavailable", *CUDA_EVENTS} else 502


def log_inference_failure(
    event: str,
    request_id: str,
    page_indexes: list[int] | None,
    attempt: int,
    context: dict[str, Any] | None = None,
    **fields: Any,
) -> None:
    """Emit structured, document-safe diagnostics for a failed inference call."""
    context = context or {}
    logger.error(json.dumps({
        "event": "inference_failure",
        "failure_event": event,
        "request_id": request_id,
        "page_indexes": list(page_indexes or []),
        "attempt": attempt,
        "cuda_error_code": context.get("cuda_error_code"),
        "message_fingerprint": context.get("message_fingerprint"),
        "exception_type": context.get("exception_type"),
        **fields,
    }))


@asynccontextmanager
async def admit_request(state: Any, max_queue_depth: int):
    """Atomically reserve a request slot before expensive work begins."""
    async with state.queue_lock:
        if state.queue_depth >= max_queue_depth:
            raise InferenceServiceError("OCR service is busy. Please retry shortly.", "busy")
        state.queue_depth += 1
    try:
        yield
    finally:
        async with state.queue_lock:
            state.queue_depth = max(0, state.queue_depth - 1)


async def reserve_request(state: Any, max_queue_depth: int) -> bool:
    async with state.queue_lock:
        if state.queue_depth >= max_queue_depth:
            return False
        state.queue_depth += 1
        return True


async def release_request(state: Any) -> None:
    async with state.queue_lock:
        state.queue_depth = max(0, state.queue_depth - 1)
