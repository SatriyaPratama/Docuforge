# DocuForge

DocuForge is a self-hosted OCR workspace for turning PDFs and images into structured, editable documents. It detects layout blocks and tables, lets you review and correct the result, and exports the corrected document as CSV, Excel, Markdown, or HTML.

Documents stay on the machine running DocuForge. The web application and OCR service run as separate containers, and the browser communicates with the OCR service through the web application's API routes.

## Highlights

- PDF, PNG, JPEG, WebP, and TIFF input up to 20 MB
- Layout-aware OCR blocks for text, tables, headers, footers, figures, and captions
- Table cell and item coordinates for visual review
- Live page progress with chunked parsing for large documents
- Local corrections with merge, undo, redo, reset, and IndexedDB restoration
- Low-confidence review queue and full-document search
- Sequential multi-document batch queue
- CSV, Excel, Markdown, and HTML export
- CPU inference by default, with opt-in NVIDIA CUDA and external vLLM deployments
- Content-hash result caching and bounded request admission

## Architecture

```text
Browser
  | upload, review, correction, export
  v
Next.js web app (:3000)
  | public API routes, validation, request IDs, streaming proxy
  v
FastAPI OCR service (:8080, internal network only)
  | PDF rasterization, page handling, result cache
  v
Surya OCR 2 (650M VLM)
  | OpenAI-compatible inference boundary
  +-- llama.cpp in the OCR container (CPU default)
  +-- llama.cpp CUDA sidecar (local NVIDIA profile)
  +-- external vLLM server (GPU or multi-GPU)
```

The browser stores OCR pages as the immutable source result and keeps user edits as a local overlay. Exports are generated from the corrected view.

## Quick start

### Prerequisites

- Docker Desktop or Docker Engine with Compose
- About 6 GB of available memory for the CPU OCR container
- Node.js 20+ and npm for web-only development or local checks

### Run the full stack

```bash
npm run stack:up
```

Open [http://localhost:3000](http://localhost:3000). The first startup downloads the Surya OCR 2 GGUF weights into `backend/ocr/data/hf` and warms the inference server. The model and runtime caches are mounted locally, so later starts are faster.

Stop the stack or follow logs with:

```bash
npm run stack:down
npm run stack:logs
```

### Run with a local NVIDIA GPU

The GPU profile keeps the model and OCR limits unchanged while moving inference to a CUDA-enabled llama.cpp sidecar:

```bash
npm run stack:gpu
```

This requires the NVIDIA Container Toolkit. The image and model files are pinned in [docker-compose.gpu.yml](docker-compose.gpu.yml). See [backend/ocr/README.md](backend/ocr/README.md) for external vLLM and CUDA diagnostics.

## Local development

Use this mode when an OCR service is already available at `localhost:8080`.

```bash
npm install
npm run dev
```

The development server runs at [http://localhost:3000](http://localhost:3000). Set `OCR_ENDPOINT` in `.env.local` when the OCR service is elsewhere. Start from [.env.example](.env.example); never commit `.env` or credentials.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OCR_ENDPOINT` | `http://localhost:8080` | OCR service URL used by the Next.js API routes |
| `SURYA_INFERENCE_BACKEND` | `llamacpp` | `llamacpp` for the bundled server or `vllm` for an external OpenAI-compatible server |
| `SURYA_INFERENCE_URL` | unset | External inference URL used with `vllm` |
| `SURYA_INFERENCE_PARALLEL` | `4` | Client-side inference concurrency |
| `INFERENCE_CONCURRENCY` | automatic | Concurrent parse requests; automatic mode is conservative for CPU |
| `CHUNK_SIZE` | automatic | Pages per OCR request when large documents are split |
| `MAX_PAGES` | `50` | Maximum pages in one OCR request |
| `MAX_QUEUE_DEPTH` | `4` | Admission limit before the service returns HTTP 429 |
| `DOCUMENT_TTL_SECONDS` | `3600` | Lifetime of temporary server-side document handles |
| `TABLE_ITEMS_ENABLED` | `1` | Enable table row, column, and cell coordinates |
| `OCR_HOST_PORT` | `8081` | Host port for the optional debug proxy |

GPU-specific settings, cache limits, and the complete backend environment are documented in [backend/ocr/README.md](backend/ocr/README.md).

## API surface

The web application exposes the public API:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/documents` | Store an upload and return a temporary document handle |
| `DELETE` | `/api/documents/:id` | Release a temporary document handle |
| `POST` | `/api/parse` | Parse a file or document handle and return JSON or NDJSON page events |
| `GET` | `/api/ocr-info` | Read OCR capabilities for chunk sizing and UI status |
| `GET` | `/api/health` | Check web application liveness |

The OCR service is internal-only and provides `/api/v1/marker`, `/health`, `/ready`, and `/info`. Do not publish those ports directly.

Page ranges are zero-based at the API boundary. Each returned page keeps its original `page_id`, so a partial parse remains aligned with the source document.

## Data handling and security

- Uploads are validated by file signatures, not by filename or MIME type.
- Temporary document handles expire and are deleted after use or release.
- The result cache is content-addressed and can be disabled per parse request.
- Corrections remain in browser IndexedDB and are not uploaded to a remote service.
- Containers run as non-root with `no-new-privileges` enabled.
- The default Compose network keeps the OCR service off the host network.
- DocuForge does not provide authentication. For shared or internet-facing use, place a TLS-terminating reverse proxy with authentication in front of the web app.
- Review the Surya OCR 2 model license before using the project commercially.

## Testing and checks

Frontend checks:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Backend checks:

```bash
cd backend/ocr
python -m pip install -r requirements.txt
python -m unittest discover -v
```

The lightweight backend tests use fake inference boundaries and do not require model weights. Full OCR smoke tests can run through the debug proxy:

```bash
docker compose --profile debug up ocr-debug-proxy
cd backend/ocr
python test_surya_ocr.py --mode api --endpoint http://localhost:8081/api/v1/marker
```

## Project layout

```text
src/app/                 Next.js app shell and API routes
src/components/          Workspace, review, search, batch, and export UI
src/context/             Application and batch state providers
src/lib/                 OCR parsing, corrections, persistence, search, and exports
backend/ocr/app/         FastAPI service, inference runtime, storage, and cache
backend/ocr/test_*.py    Backend contract and resilience tests
docker-compose.yml       Default CPU stack and optional debug proxy
docker-compose.gpu.yml   Opt-in CUDA sidecar override
```
