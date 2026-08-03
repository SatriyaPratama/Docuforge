import asyncio
import hashlib
import io
import json
import logging
import os
import re
import sys
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

from bs4 import BeautifulSoup
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
import httpx
from PIL import Image
import pypdfium2 as pdfium

from surya.inference import SuryaInferenceManager
import surya.recognition as surya_recognition
from surya.recognition import RecognitionPredictor
from surya.table_rec import TableRecPredictor
from app.inference_runtime import (
    CUDA_EVENTS,
    InferenceServiceError,
    inference_failure,  # compatibility re-export for existing imports
    inference_failure_context,
    inference_http_status,
    initial_inference_status,
    log_inference_failure,
    record_inference_event,
    release_request,
    reserve_request,
)
from app.document_store import DocumentStore
from app.result_cache import ResultCache
from app.settings import Settings

# Compatibility aliases for older imports from ``app.main``.
_initial_inference_status = initial_inference_status
_record_inference_event = record_inference_event

# Limits and configuration
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # keep in sync with webapp fileConstraints.ts


def _int_env(name: str, default: int) -> int:
    """Parse an int env var, tolerating unset/empty/invalid values."""
    try:
        return int(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float) -> float:
    """Parse a float env var, tolerating unset/empty/invalid values."""
    try:
        return float(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return default


MAX_PAGES = _int_env("MAX_PAGES", 50)
TARGET_LONG_EDGE_PX = _int_env("RENDER_LONG_EDGE_PX", 2048)
RESULT_CACHE_DIR = os.getenv("RESULT_CACHE_DIR", "/data/cache/results")
DOCUMENT_DIR = os.getenv("DOCUMENT_DIR", "/data/documents")
DOCUMENT_TTL_SECONDS = max(_int_env("DOCUMENT_TTL_SECONDS", 3600), 60)
# Namespaces cache entries so results from other models are never served.
MODEL_TAG = "surya-ocr-2-boxes-v1"
TABLE_ITEMS_ENABLED = (
    os.getenv("TABLE_ITEMS_ENABLED", "1").strip().lower()
    not in {"0", "false", "no", "off"}
)

# Inference backend and request concurrency.
INFERENCE_BACKEND = (os.getenv("SURYA_INFERENCE_BACKEND", "auto").strip().lower() or "auto")
INFERENCE_CONCURRENCY = max(
    1, _int_env("INFERENCE_CONCURRENCY", 4 if INFERENCE_BACKEND == "vllm" else 1)
)
MAX_QUEUE_DEPTH = max(_int_env("MAX_QUEUE_DEPTH", 4), INFERENCE_CONCURRENCY + 2)
# Per-request page batch, capped at MAX_PAGES.
CHUNK_SIZE = max(1, min(MAX_PAGES, _int_env("CHUNK_SIZE", 25 if INFERENCE_BACKEND == "vllm" else 4)))
# Informational device label surfaced in /info and the UI.
DEVICE = (os.getenv("DOCUFORGE_DEVICE", "cpu").strip().lower() or "cpu")
INFERENCE_HEALTH_URL = os.getenv("SURYA_INFERENCE_HEALTH_URL", "").strip()
INFERENCE_READY_TIMEOUT_SECONDS = max(
    _float_env("INFERENCE_READY_TIMEOUT_SECONDS", 30.0), 5.0
)
INFERENCE_RECOVERY_ATTEMPTS = max(_int_env("INFERENCE_RECOVERY_ATTEMPTS", 1), 0)
INFERENCE_RECOVERY_BACKOFF_SECONDS = max(
    _float_env("INFERENCE_RECOVERY_BACKOFF_SECONDS", 1.0), 0.25
)

# Decompression-bomb guard for untrusted images (~64 MP cap).
Image.MAX_IMAGE_PIXELS = 64_000_000
SETTINGS = Settings.from_environment()
DOCUMENT_STORE = DocumentStore(DOCUMENT_DIR, DOCUMENT_TTL_SECONDS, MAX_UPLOAD_BYTES)
RESULT_CACHE = ResultCache(
    RESULT_CACHE_DIR,
    MODEL_TAG,
    SETTINGS.result_cache_ttl_seconds,
    SETTINGS.result_cache_max_bytes,
)

# Structured logging
logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(message)s")
logger = logging.getLogger("surya-ocr")


def log_event(event: str, **fields: Any) -> None:
    logger.info(json.dumps({"event": event, "ts": time.time(), **fields}))


async def _probe_inference_health() -> tuple[bool, str]:
    """Probe the external llama health endpoint when GPU mode configures one."""
    if not INFERENCE_HEALTH_URL:
        return True, "health_probe_not_configured"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(INFERENCE_HEALTH_URL)
        if response.is_success:
            return True, "ready"
        return False, f"http_{response.status_code}"
    except httpx.HTTPError as exc:
        return False, type(exc).__name__


async def wait_for_inference_ready(
    state: Any,
    request_id: str,
    page_indexes: list[int] | None = None,
) -> None:
    """Wait for a restarted sidecar with bounded exponential backoff."""
    if not INFERENCE_HEALTH_URL:
        return

    started = time.monotonic()
    attempt = 0
    saw_unready = False
    while time.monotonic() - started < INFERENCE_READY_TIMEOUT_SECONDS:
        ready, reason = await _probe_inference_health()
        if ready:
            record_inference_event(state, "inference_ready", None, request_id=request_id, page_indexes=page_indexes)
            if saw_unready:
                log_event(
                    "inference_ready",
                    request_id=request_id,
                    recovery_attempts=attempt,
                    seconds=round(time.monotonic() - started, 2),
                )
            return
        if not saw_unready:
            record_inference_event(state, "inference_waiting", "health probe pending", request_id=request_id, page_indexes=page_indexes)
            log_event("inference_wait_start", request_id=request_id)
            saw_unready = True
        delay = min(INFERENCE_RECOVERY_BACKOFF_SECONDS * (2**attempt), 8.0)
        attempt += 1
        await asyncio.sleep(delay)

    detail = (
        "The GPU OCR server did not become ready within the recovery window. "
        "The container may still be reloading the model; retry shortly."
    )
    record_inference_event(state, "inference_unavailable", detail, request_id=request_id, page_indexes=page_indexes)
    log_event(
        "inference_unavailable",
        request_id=request_id,
        reason=reason,
        attempts=attempt,
        seconds=round(time.monotonic() - started, 2),
    )
    raise InferenceServiceError(detail, "inference_unavailable")


async def run_predictor_with_recovery(
    predictor: RecognitionPredictor,
    images: list[Image.Image],
    state: Any,
    request_id: str,
    page_indexes: list[int] | None = None,
) -> list[Any]:
    """Run one OCR call, retrying only when the external sidecar is unavailable."""
    for attempt in range(INFERENCE_RECOVERY_ATTEMPTS + 1):
        try:
            await wait_for_inference_ready(state, request_id, page_indexes)
            results = await asyncio.to_thread(predictor, images)
        except InferenceServiceError:
            if attempt >= INFERENCE_RECOVERY_ATTEMPTS:
                raise
            await asyncio.sleep(min(INFERENCE_RECOVERY_BACKOFF_SECONDS * (2**attempt), 8.0))
            continue
        except Exception as exc:
            detail, event, context = inference_failure_context(exc)
            record_inference_event(
                state,
                event,
                detail,
                request_id=request_id,
                page_indexes=page_indexes,
                attempt=attempt,
                **context,
            )
            log_inference_failure(event, request_id, page_indexes, attempt, context)
            if event not in {"inference_unavailable", *CUDA_EVENTS} or attempt >= INFERENCE_RECOVERY_ATTEMPTS:
                raise InferenceServiceError(detail, event) from exc
            await asyncio.sleep(min(INFERENCE_RECOVERY_BACKOFF_SECONDS * (2**attempt), 8.0))
            continue

        ready, reason = await _probe_inference_health()
        if ready:
            record_inference_event(state, "inference_ready", None, request_id=request_id, page_indexes=page_indexes)
            return results
        detail = "The GPU OCR server stopped responding during inference. It is recovering; retry shortly."
        record_inference_event(state, "inference_unavailable", reason, request_id=request_id, page_indexes=page_indexes, attempt=attempt)
        if attempt >= INFERENCE_RECOVERY_ATTEMPTS:
            raise InferenceServiceError(detail, "inference_unavailable")
        await asyncio.sleep(min(INFERENCE_RECOVERY_BACKOFF_SECONDS * (2**attempt), 8.0))

    raise InferenceServiceError(
        "The GPU OCR server could not complete inference. Please retry shortly.",
        "inference_unavailable",
    )


# Model lifecycle
# Build and warm the predictor at startup. The semaphore serializes inference;
# the queue-depth counter provides backpressure.
def parse_full_page_html_with_coordinates(text: str) -> list[SimpleNamespace]:
    """Keep nested Surya data-bbox attributes for the interactive UI."""
    cleaned = re.sub(r"^```(?:html)?\s*|\s*```$", "", (text or "").strip(), flags=re.IGNORECASE)
    if not cleaned:
        return []
    soup = BeautifulSoup(cleaned, "html.parser")
    root = soup.body or soup
    parsed: list[SimpleNamespace] = []
    for div in root.find_all("div", recursive=False):
        label = div.get("data-label")
        bbox_text = div.get("data-bbox")
        if not label or not bbox_text:
            continue
        try:
            parts = [float(value) for value in bbox_text.split()]
        except ValueError:
            continue
        if len(parts) != 4:
            continue
        parsed.append(SimpleNamespace(
            label=str(label),
            bbox=(parts[0], parts[1], parts[2], parts[3]),
            html="".join(str(child) for child in div.contents).strip(),
        ))
    return parsed


# RecognitionPredictor resolves this helper from its module globals at call time.
surya_recognition.parse_full_page_html = parse_full_page_html_with_coordinates


@asynccontextmanager
async def lifespan(app: FastAPI):
    started = time.time()
    app.state.inference_status = initial_inference_status()
    app.state.inference_status["health_url_configured"] = bool(INFERENCE_HEALTH_URL)
    log_event("model_load_start", backend=INFERENCE_BACKEND, concurrency=INFERENCE_CONCURRENCY)

    def _build_and_warm() -> tuple[RecognitionPredictor, TableRecPredictor]:
        manager = SuryaInferenceManager()
        predictor = RecognitionPredictor(manager)
        table_predictor = TableRecPredictor(manager)
        # Warmup: spawns/attaches the inference server and validates one decode.
        predictor([Image.new("RGB", (64, 64), "white")])
        return predictor, table_predictor

    app.state.predictor, app.state.table_predictor = await asyncio.to_thread(_build_and_warm)
    app.state.ready = True
    record_inference_event(app.state, "inference_ready", None)
    app.state.inference_lock = asyncio.Semaphore(INFERENCE_CONCURRENCY)
    app.state.queue_lock = asyncio.Lock()
    app.state.queue_depth = 0
    os.makedirs(RESULT_CACHE_DIR, exist_ok=True)
    os.makedirs(DOCUMENT_DIR, exist_ok=True)
    cleanup_documents()
    await asyncio.to_thread(RESULT_CACHE.prune)
    log_event(
        "model_load_done",
        backend=INFERENCE_BACKEND,
        concurrency=INFERENCE_CONCURRENCY,
        seconds=round(time.time() - started, 1),
    )
    yield


app = FastAPI(title="DocuForge Surya OCR Backend", version="3.0.0", lifespan=lifespan)

# Surya canonical labels → frontend BlockType values.
# Unlisted labels fall back to "Text"; BlankPage blocks are dropped entirely.
LABEL_TO_BLOCK_TYPE: dict[str, str] = {
    "pageheader": "PageHeader",
    "sectionheader": "SectionHeader",
    "text": "Text",
    "listgroup": "Text",
    "code": "Text",
    "equation": "Text",
    "form": "Text",
    "footnote": "Text",
    "bibliography": "Text",
    "tableofcontents": "Text",
    "chemicalblock": "Text",
    "table": "Table",
    "picture": "Figure",
    "figure": "Figure",
    "diagram": "Figure",
    "caption": "FigureCaption",
    "pagefooter": "PageFooter",
}

DROPPED_LABELS = {"blankpage"}


def parse_page_range(value: str | None, page_count: int) -> list[int]:
    if not value:
        return list(range(page_count))

    text = value.strip()
    if not text:
        return list(range(page_count))

    if "-" in text:
        left, right = text.split("-", 1)
        start = int(left)
        end = int(right)
        if start < 0 or end < 0 or end < start:
            raise ValueError("Invalid page_range")
        return [idx for idx in range(start, end + 1) if idx < page_count]

    idx = int(text)
    if idx < 0:
        raise ValueError("Invalid page_range")
    return [idx] if idx < page_count else []


def is_pdf(content: bytes) -> bool:
    # Trust content, not the client-supplied filename/MIME type.
    if isinstance(content, str):
        try:
            with open(content, "rb") as handle:
                return handle.read(5) == b"%PDF-"
        except OSError:
            return False
    return content[:5] == b"%PDF-"


def count_pdf_pages(content: bytes) -> int:
    doc = pdfium.PdfDocument(content if isinstance(content, str) else io.BytesIO(content))
    try:
        return len(doc)
    finally:
        doc.close()


def render_pdf_pages(content: bytes, page_indexes: list[int]) -> list[Image.Image]:
    """Rasterize only the requested pages, scaled to a target long edge."""
    doc = pdfium.PdfDocument(content if isinstance(content, str) else io.BytesIO(content))
    images: list[Image.Image] = []
    try:
        for idx in page_indexes:
            page = doc[idx]
            width_pts, height_pts = page.get_size()
            long_edge = max(width_pts, height_pts) or 1.0
            scale = min(4.0, max(1.0, TARGET_LONG_EDGE_PX / long_edge))
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil()
            if pil.mode != "RGB":
                pil = pil.convert("RGB")
            images.append(pil)
            page.close()
    finally:
        doc.close()
    return images


def load_single_image(content: bytes) -> Image.Image:
    image = Image.open(content if isinstance(content, str) else io.BytesIO(content))
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def normalise_block_type(label: str | None) -> str | None:
    """Map a Surya canonical label to a frontend block type (None = drop)."""
    key = (label or "").strip().lower().replace("-", "").replace("_", "")
    if key in DROPPED_LABELS:
        return None
    return LABEL_TO_BLOCK_TYPE.get(key, "Text")


def markdown_from_html(html: str) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)


def _crop_bbox(image: Image.Image, bbox: list[float] | tuple[float, ...]) -> tuple[Image.Image, float, float] | None:
    if len(bbox) != 4:
        return None
    x0, y0, x1, y1 = (float(value) for value in bbox)
    left = max(0, min(image.width - 1, int(x0)))
    top = max(0, min(image.height - 1, int(y0)))
    right = max(left + 1, min(image.width, int(x1)))
    bottom = max(top + 1, min(image.height, int(y1)))
    if right <= left or bottom <= top:
        return None
    return image.crop((left, top, right, bottom)), float(left), float(top)


def _bbox_from_polygon(polygon: Any, offset_x: float = 0, offset_y: float = 0) -> list[float] | None:
    if not isinstance(polygon, (list, tuple)) or not polygon:
        return None
    try:
        points = [(float(point[0]), float(point[1])) for point in polygon if len(point) >= 2]
    except (TypeError, ValueError):
        return None
    if not points:
        return None
    return [
        min(point[0] for point in points) + offset_x,
        min(point[1] for point in points) + offset_y,
        max(point[0] for point in points) + offset_x,
        max(point[1] for point in points) + offset_y,
    ]


def _attach_table_items(
    image: Image.Image,
    blocks: list[dict[str, Any]],
    table_predictor: TableRecPredictor,
    request_id: str,
) -> None:
    if not TABLE_ITEMS_ENABLED:
        return

    regions: list[tuple[dict[str, Any], Image.Image, float, float]] = []
    for block in blocks:
        if block.get("block_type") != "Table" or not block.get("bbox"):
            continue
        cropped = _crop_bbox(image, block["bbox"])
        if cropped is not None:
            crop, offset_x, offset_y = cropped
            regions.append((block, crop, offset_x, offset_y))
    if not regions:
        return

    try:
        table_results = table_predictor([region[1] for region in regions], mode="simple")
    except Exception:
        log_event("table_items_failed", request_id=request_id, tables=len(regions))
        return

    for (block, _crop, offset_x, offset_y), table_result in zip(regions, table_results):
        items: list[dict[str, Any]] = []
        for kind, elements in (("row", table_result.rows), ("column", table_result.cols), ("cell", table_result.cells)):
            for element in elements:
                bbox = _bbox_from_polygon(getattr(element, "polygon", None), offset_x, offset_y)
                if bbox is None:
                    continue
                item: dict[str, Any] = {
                    "kind": kind,
                    "bbox": bbox,
                    "confidence": getattr(element, "confidence", None),
                }
                for field in ("row_id", "col_id", "cell_id"):
                    value = getattr(element, field, None)
                    if value is not None:
                        item[field] = value
                items.append(item)
        if items:
            block["items"] = items


def page_result_to_blocks(
    result: Any,
    request_id: str,
    image: Image.Image | None = None,
    table_predictor: TableRecPredictor | None = None,
) -> list[dict[str, Any]]:
    """Convert one Surya PageOCRResult into the marker block contract."""
    raw_blocks = sorted(
        getattr(result, "blocks", []) or [],
        key=lambda b: getattr(b, "reading_order", 0) or 0,
    )

    blocks: list[dict[str, Any]] = []
    error_count = 0
    for raw in raw_blocks:
        if getattr(raw, "error", False):
            error_count += 1
            continue

        block_type = normalise_block_type(getattr(raw, "label", None))
        if block_type is None:
            continue

        html = getattr(raw, "html", "") or ""
        bbox = getattr(raw, "bbox", None)
        confidence = getattr(raw, "confidence", None)
        blocks.append(
            {
                "id": f"blk-{len(blocks) + 1}",
                "block_type": block_type,
                "html": html,
                "markdown": markdown_from_html(html),
                "bbox": list(bbox) if bbox is not None else None,
                "confidence": round(float(confidence), 4)
                if isinstance(confidence, (int, float))
                else None,
            }
        )

    if error_count:
        log_event("block_errors", request_id=request_id, count=error_count)
    if image is not None and table_predictor is not None:
        _attach_table_items(image, blocks, table_predictor, request_id)
    return blocks


def page_dims(result: Any) -> tuple[int | None, int | None]:
    """Pixel width/height of the rendered page image (from Surya's image_bbox)."""
    ib = getattr(result, "image_bbox", None)
    if isinstance(ib, (list, tuple)) and len(ib) == 4:
        try:
            return int(round(ib[2])), int(round(ib[3]))
        except (TypeError, ValueError):
            return None, None
    return None, None


def filter_blocks(blocks: list[dict[str, Any]], keep_header: bool, keep_footer: bool) -> list[dict[str, Any]]:
    dropped_types = set()
    if not keep_header:
        dropped_types.add("PageHeader")
    if not keep_footer:
        dropped_types.add("PageFooter")
    if not dropped_types:
        return blocks
    return [b for b in blocks if b.get("block_type") not in dropped_types]


# Result cache
def cache_key(content_hash: str, page_indexes: list[int]) -> str:
    return RESULT_CACHE.key(content_hash, page_indexes)


def cache_read(key: str) -> list[dict[str, Any]] | None:
    return RESULT_CACHE.read(key)


def cache_write(key: str, pages: list[dict[str, Any]]) -> None:
    RESULT_CACHE.write(key, pages)


# Temporary document store
DOCUMENT_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _document_paths(document_id: str) -> tuple[str, str]:
    if not DOCUMENT_ID_PATTERN.fullmatch(document_id):
        raise HTTPException(status_code=400, detail="Invalid document_id")
    canonical_id = str(UUID(document_id))
    return (
        os.path.join(DOCUMENT_DIR, f"{canonical_id}.bin"),
        os.path.join(DOCUMENT_DIR, f"{canonical_id}.json"),
    )


def cleanup_documents() -> None:
    os.makedirs(DOCUMENT_DIR, exist_ok=True)
    cutoff = time.time() - DOCUMENT_TTL_SECONDS
    try:
        for entry in os.scandir(DOCUMENT_DIR):
            try:
                if entry.is_file() and entry.stat().st_mtime < cutoff:
                    os.remove(entry.path)
            except OSError:
                continue
    except OSError:
        return


def store_document(content: bytes, content_hash: str, page_count: int) -> tuple[str, dict[str, Any]]:
    os.makedirs(DOCUMENT_DIR, exist_ok=True)
    document_id = str(uuid4())
    path, metadata_path = _document_paths(document_id)
    metadata = {
        "document_id": document_id,
        "content_sha256": content_hash,
        "page_count": page_count,
        "size_bytes": len(content),
    }
    temp_path = f"{path}.{uuid4().hex}.tmp"
    temp_metadata_path = f"{metadata_path}.{uuid4().hex}.tmp"
    try:
        with open(temp_path, "wb") as fh:
            fh.write(content)
        os.replace(temp_path, path)
        with open(temp_metadata_path, "w", encoding="utf-8") as fh:
            json.dump(metadata, fh)
        os.replace(temp_metadata_path, metadata_path)
    except OSError as exc:
        for candidate in (temp_path, temp_metadata_path, path, metadata_path):
            try:
                os.remove(candidate)
            except OSError:
                pass
        raise HTTPException(status_code=503, detail="Could not store the document.") from exc
    return document_id, metadata


def load_document(document_id: str) -> tuple[bytes, dict[str, Any]]:
    path, metadata_path = _document_paths(document_id)
    try:
        with open(path, "rb") as fh:
            content = fh.read()
        with open(metadata_path, "r", encoding="utf-8") as fh:
            metadata = json.load(fh)
        now = time.time()
        os.utime(path, (now, now))
        os.utime(metadata_path, (now, now))
        return content, metadata
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document has expired or was not found.") from exc
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=500, detail="Stored document could not be read.") from exc


def delete_document(document_id: str) -> None:
    path, metadata_path = _document_paths(document_id)
    for candidate in (path, metadata_path):
        try:
            os.remove(candidate)
        except FileNotFoundError:
            continue
        except OSError:
            log_event("document_delete_failed", document_id=document_id)


def validate_image(content: bytes) -> None:
    try:
        with Image.open(content if isinstance(content, str) else io.BytesIO(content)) as image:
            image.verify()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Failed to decode the image.") from exc


# Endpoints
@app.get("/health")
def health(request: Request) -> dict[str, Any]:
    """Liveness: the process is up (inference server may still be starting)."""
    return {
        "status": "ok",
        "inference": getattr(request.app.state, "inference_status", initial_inference_status()),
    }


@app.get("/ready")
def ready(request: Request) -> JSONResponse:
    """Readiness: predictor built and the inference server answered a warmup."""
    is_ready = getattr(request.app.state, "ready", False)
    return JSONResponse(
        {
            "ready": is_ready,
            "inference": getattr(request.app.state, "inference_status", initial_inference_status()),
        },
        status_code=200 if is_ready else 503,
    )


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "docuforge-surya-ocr",
        "status": "ok",
        "backend": INFERENCE_BACKEND,
        "health": "/health",
        "ready": "/ready",
        "info": "/info",
        "docs": "/docs",
        "parse_endpoint": "/api/v1/marker (POST)",
    }


@app.get("/info")
def info() -> JSONResponse:
    """Capabilities the web app reads to size chunks and show the active mode."""
    return JSONResponse(
        {
            "backend": INFERENCE_BACKEND,
            "device": DEVICE,
            "model": MODEL_TAG,
            "max_pages": MAX_PAGES,
            "chunk_size": CHUNK_SIZE,
            "concurrency": INFERENCE_CONCURRENCY,
            "max_upload_bytes": MAX_UPLOAD_BYTES,
            "table_items": TABLE_ITEMS_ENABLED,
        }
    )


@app.post("/api/v1/documents")
async def create_document(
    request: Request,
    file: UploadFile = File(...),
) -> JSONResponse:
    request_id = request.headers.get("X-Request-ID", "-")
    cleanup_documents()
    stored = await DOCUMENT_STORE.store_upload(file, count_pdf_pages, validate_image)
    metadata = stored.public_metadata()
    log_event(
        "document_stored",
        request_id=request_id,
        document_id=stored.document_id,
        pages=stored.page_count,
        size_bytes=stored.size_bytes,
    )
    return JSONResponse(metadata)


@app.delete("/api/v1/documents/{document_id}")
def remove_document(document_id: str) -> Response:
    delete_document(document_id)
    return Response(status_code=204)


@app.post("/api/v1/marker")
async def marker(
    request: Request,
    file: UploadFile | None = File(None),
    output_format: str = Form("json"),
    page_range: str | None = Form(None),
    skip_cache: bool = Form(False),
    keep_header: bool = Form(True),
    keep_footer: bool = Form(True),
    content_sha256: str | None = Form(None),
    stream: bool = Form(False),
    document_id: str | None = Form(None),
) -> Response:
    request_id = request.headers.get("X-Request-ID", "-")
    started = time.time()

    if output_format != "json":
        raise HTTPException(status_code=400, detail="Only output_format=json is supported.")

    cleanup_documents()
    if file is not None and document_id:
        raise HTTPException(status_code=400, detail="Send either file or document_id, not both.")
    if document_id:
        stored = DOCUMENT_STORE.load(document_id)
        content = stored.path
        stored_hash = stored.content_sha256
        if content_sha256 and content_sha256.lower() != stored_hash.lower():
            raise HTTPException(status_code=400, detail="Document hash does not match document_id.")
        content_hash = stored_hash
    elif file is not None:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit.")
        content_hash = hashlib.sha256(content).hexdigest()
    else:
        raise HTTPException(status_code=400, detail="No file or document_id provided.")

    pdf = is_pdf(content)

    # Resolve which pages to process before rendering anything.
    try:
        page_count = stored.page_count if document_id else (count_pdf_pages(content) if pdf else 1)
    except Exception:
        log_event("decode_failed", request_id=request_id, kind="pdf" if pdf else "image")
        raise HTTPException(status_code=400, detail="Failed to decode the document.")

    try:
        page_indexes = parse_page_range(page_range, page_count)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not page_indexes:
        return JSONResponse({"pages": [], "meta": _meta(False, skip_cache, keep_header, keep_footer)})

    if len(page_indexes) > MAX_PAGES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Too many pages ({len(page_indexes)}) for a single request "
                f"(limit {MAX_PAGES}). The web app splits large documents into "
                f"chunks automatically; when calling the API directly, use page_range."
            ),
        )

    key = cache_key(content_hash, page_indexes)
    state = request.app.state

    # Stream one NDJSON event per page.
    if stream:
        cached_stream = None if skip_cache else cache_read(key)
        stream_admitted = False
        if cached_stream is None:
            stream_admitted = await reserve_request(state, MAX_QUEUE_DEPTH)
            if not stream_admitted:
                log_event("rejected_busy", request_id=request_id, queue_depth=state.queue_depth)
                raise HTTPException(status_code=429, detail="OCR service is busy. Please retry shortly.")
            try:
                await wait_for_inference_ready(state, request_id, page_indexes)
            except InferenceServiceError as exc:
                await release_request(state)
                raise HTTPException(
                    status_code=inference_http_status(exc.event),
                    detail=exc.detail,
                    headers={"Retry-After": "5"},
                ) from exc

        async def stream_pages():
            def line(obj: dict[str, Any]) -> bytes:
                return (json.dumps(obj) + "\n").encode()

            if cached_stream is not None:
                for p in cached_stream:
                    yield line({
                        "type": "page",
                        "id": p["id"],
                        "page_id": p["page_id"],
                        "width": p.get("width"),
                        "height": p.get("height"),
                        "blocks": filter_blocks(p["blocks"], keep_header, keep_footer),
                    })
                yield line({"type": "done", "total": len(cached_stream), "meta": _meta(True, skip_cache, keep_header, keep_footer)})
                log_event("parse_ok", request_id=request_id, cached=True, stream=True, pages=len(cached_stream), duration_s=round(time.time() - started, 2))
                return

            predictor: RecognitionPredictor = state.predictor
            collected: list[dict[str, Any]] = []
            try:
                async with state.inference_lock:
                    for out_idx, in_idx in enumerate(page_indexes):
                        if await request.is_disconnected():
                            log_event("stream_disconnected", request_id=request_id, pages=len(collected))
                            return
                        try:
                            image = (await asyncio.to_thread(render_pdf_pages, content, [in_idx]))[0] if pdf else await asyncio.to_thread(load_single_image, content)
                        except Exception:
                            log_event("decode_failed", request_id=request_id, kind="pdf" if pdf else "image")
                            yield line({"type": "error", "detail": "Failed to decode the document."})
                            return
                        try:
                            result = (await run_predictor_with_recovery(
                                predictor, [image], state, request_id, [in_idx]
                            ))[0]
                        except InferenceServiceError as exc:
                            log_event(exc.event, request_id=request_id, page_indexes=[in_idx], stream=True)
                            image.close()
                            yield line({"type": "error", "detail": exc.detail})
                            return
                        except Exception as exc:
                            detail, event, context = inference_failure_context(exc)
                            record_inference_event(state, event, detail, request_id=request_id, page_indexes=[in_idx], **context)
                            log_inference_failure(event, request_id, [in_idx], 0, context, stream=True)
                            image.close()
                            yield line({"type": "error", "detail": detail})
                            return
                        try:
                            blocks = await asyncio.to_thread(page_result_to_blocks, result, request_id, image, state.table_predictor)
                            w, h = page_dims(result)
                            collected.append({"id": out_idx, "page_id": in_idx, "width": w, "height": h, "blocks": blocks})
                            yield line({
                                "type": "page",
                                "id": out_idx,
                                "page_id": in_idx,
                                "width": w,
                                "height": h,
                                "blocks": filter_blocks(blocks, keep_header, keep_footer),
                            })
                        finally:
                            image.close()
            finally:
                if stream_admitted:
                    await release_request(state)
            cache_write(key, collected)
            yield line({"type": "done", "total": len(collected), "meta": _meta(False, skip_cache, keep_header, keep_footer)})
            log_event("parse_ok", request_id=request_id, cached=False, stream=True, pages=len(collected), duration_s=round(time.time() - started, 2))

        return StreamingResponse(stream_pages(), media_type="application/x-ndjson")

    # Apply header/footer filtering after a cache hit so one result serves every
    # filtering combination.
    if not skip_cache:
        cached = cache_read(key)
        if cached is not None:
            pages = [
                {**p, "blocks": filter_blocks(p["blocks"], keep_header, keep_footer)}
                for p in cached
            ]
            log_event(
                "parse_ok", request_id=request_id, cached=True,
                pages=len(pages), duration_s=round(time.time() - started, 2),
            )
            return JSONResponse({"pages": pages, "meta": _meta(True, skip_cache, keep_header, keep_footer)})

    # Reject requests once the admission limit is reached.

    admitted = await reserve_request(state, MAX_QUEUE_DEPTH)
    if not admitted:
        log_event("rejected_busy", request_id=request_id, queue_depth=state.queue_depth)
        raise HTTPException(status_code=429, detail="OCR service is busy. Please retry shortly.")

    try:
        await wait_for_inference_ready(state, request_id, page_indexes)
    except InferenceServiceError as exc:
        await release_request(state)
        raise HTTPException(
            status_code=inference_http_status(exc.event),
            detail=exc.detail,
            headers={"Retry-After": "5"},
        ) from exc

    # Rasterize in a worker thread (CPU-bound).
    try:
        if pdf:
            images = await asyncio.to_thread(render_pdf_pages, content, page_indexes)
        else:
            images = [await asyncio.to_thread(load_single_image, content)]
    except Exception:
        log_event("decode_failed", request_id=request_id, kind="pdf" if pdf else "image")
        await release_request(state)
        raise HTTPException(status_code=400, detail="Failed to decode the document.")

    predictor: RecognitionPredictor = state.predictor

    pages: list[dict[str, Any]] = []
    try:
        async with state.inference_lock:
            try:
                # Keep the batch together so Surya can use its configured
                # inference parallelism while the event loop stays responsive.
                results = await run_predictor_with_recovery(
                    predictor, images, state, request_id, page_indexes
                )
            except InferenceServiceError as exc:
                log_event(exc.event, request_id=request_id, page_indexes=page_indexes)
                raise HTTPException(
                    status_code=inference_http_status(exc.event),
                    detail=exc.detail,
                    headers={"Retry-After": "5"},
                ) from exc
            except Exception as exc:
                detail, event, context = inference_failure_context(exc)
                record_inference_event(state, event, detail, request_id=request_id, page_indexes=page_indexes, **context)
                log_inference_failure(event, request_id, page_indexes, 0, context)
                raise HTTPException(
                    status_code=inference_http_status(event),
                    detail=detail,
                ) from exc
            for page_out_idx, (page_in_idx, result) in enumerate(zip(page_indexes, results)):
                blocks = await asyncio.to_thread(page_result_to_blocks, result, request_id, images[page_out_idx], state.table_predictor)
                w, h = page_dims(result)
                pages.append({"id": page_out_idx, "page_id": page_in_idx, "width": w, "height": h, "blocks": blocks})
    finally:
        for image in images:
            image.close()
        await release_request(state)

    cache_write(key, pages)

    filtered_pages = [
        {**p, "blocks": filter_blocks(p["blocks"], keep_header, keep_footer)}
        for p in pages
    ]

    log_event(
        "parse_ok", request_id=request_id, cached=False,
        pages=len(filtered_pages), duration_s=round(time.time() - started, 2),
    )
    return JSONResponse({"pages": filtered_pages, "meta": _meta(False, skip_cache, keep_header, keep_footer)})


def _meta(cached: bool, skip_cache: bool, keep_header: bool, keep_footer: bool) -> dict[str, Any]:
    return {
        "model": MODEL_TAG,
        "cached": cached,
        "skip_cache": skip_cache,
        "keep_header": keep_header,
        "keep_footer": keep_footer,
    }
