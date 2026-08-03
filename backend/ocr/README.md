# Surya OCR Backend (Internal Service)

This folder contains a Python FastAPI backend that wraps Surya OCR 2 for DocuForge.

## What it provides

- Endpoint: `POST /api/v1/marker`
- Health check: `GET /health` (liveness) — `GET /ready` (readiness, 503 until warmup)
- Input: multipart form-data (same shape expected by the Next.js route)
- Output: JSON with `pages[].blocks[]` (block_type, html, markdown, bbox)

## Runtime model

- Browser -> Next.js app (`/api/parse`)
- Next.js route -> `surya-ocr` service (`http://surya-ocr:8080/api/v1/marker`)

Surya OCR 2 is a 650M-param VLM that always runs behind an OpenAI-compatible
inference server. This service supports two backends:

| Backend | How it runs | When |
| --- | --- | --- |
| `llamacpp` (default) | `llama-server` binary bundled in the image; `SuryaInferenceManager` auto-spawns it with GGUF weights (`datalab-to/surya-ocr-2-gguf`, downloaded to `/data/hf` on first run) | CPU deployments |
| `vllm` | Attach to an **external** vLLM server via `SURYA_INFERENCE_URL` (auto-spawn is not possible inside the container — it requires Docker) | NVIDIA GPU deployments |

Configuration is environment-driven (nothing hardcoded in `main.py`):

- `SURYA_INFERENCE_BACKEND` — `llamacpp` (default) or `vllm`
- `SURYA_INFERENCE_URL` — OpenAI-compatible server URL (leave **unset** for
  llamacpp auto-spawn; an empty string breaks auto-spawn)
- `SURYA_INFERENCE_PARALLEL` — client-side concurrency to the server (default 4)
- `INFERENCE_CONCURRENCY` — how many parse requests the service serves at once.
  Blank = auto (**1** for CPU, **4** for vLLM). On GPU this is what lets
  large-document chunks run in parallel.
- `MAX_PAGES`, `CHUNK_SIZE`, `MAX_QUEUE_DEPTH`, `RENDER_LONG_EDGE_PX` — limits

### GPU setup with an external vLLM server

Surya cannot auto-spawn vLLM inside this container (vLLM's engine needs Docker
+ the NVIDIA Container Toolkit), so run vLLM **separately** on the GPU host and
point DocuForge at it.

1. Start a vLLM OpenAI-compatible server serving the Surya 2 weights, e.g.:

   ```bash
   docker run --gpus all -p 8000:8000 \
     vllm/vllm-openai:latest \
     --model datalab-to/surya-ocr-2 --served-model-name datalab-to/surya-ocr-2
   ```

2. In `.env` (consumed by `docker-compose.yml`):

   ```bash
   SURYA_INFERENCE_BACKEND=vllm
   SURYA_INFERENCE_URL=http://host.docker.internal:8000/v1
   INFERENCE_CONCURRENCY=4        # serve several chunks at once on the GPU
   ```

3. Uncomment the `SURYA_INFERENCE_URL` line in `docker-compose.yml`, then
   `docker compose up`. The service logs the resolved backend + concurrency at
   startup and reports it at `GET /info`.

GPU mode dramatically raises throughput and, combined with client-side
chunking, processes large documents in parallel. On multi-GPU / remote hosts,
set `SURYA_INFERENCE_URL` to that host instead of `host.docker.internal`.

### Opt-in GPU in-container (NVIDIA via CUDA) — recommended for one local GPU

For a single local NVIDIA GPU you don't need a separate vLLM server.
`docker-compose.gpu.yml` adds a `llama-cuda` sidecar running the official
ggml-org CUDA build of `llama-server`, fully offloading the Surya 2 GGUF to the
GPU (`-ngl 99`). `surya-ocr` attaches to it via `SURYA_INFERENCE_URL` (it does
**not** spawn its own server). CUDA works inside WSL2 containers (unlike Vulkan),
so this is the reliable local-GPU path.

```bash
npm run stack:gpu        # docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
# CPU (default, unchanged):  npm run stack:up
```

- Requires an NVIDIA GPU + the NVIDIA Container Toolkit (Docker Desktop + WSL2
  provide it). `gpus: all` passes the GPU into the sidecar.
- **Small-VRAM tuning**: the sidecar uses `-ngl 99 --ctx-size 12288 --batch-size 128 --ubatch-size 64 --parallel 1` with Flash Attention enabled by default for throughput on 4 GB cards,
  fitting the ~1.5 GB of weights + KV cache into a 4 GB card (e.g. RTX 3050 —
  measured **~9–12 s/page**, vs ~225 s/page on CPU). Larger cards can raise
  `--parallel` / `--ctx-size`. Surya output budgets are also reduced on this
  profile, and GPU allocation failures return an actionable page-range error.
- Keep the production flags above unchanged when investigating intermittent
  CUDA failures. Lowering `LLAMA_BATCH_SIZE`, `LLAMA_UBATCH_SIZE`, or disabling
  Flash Attention is a staging-only diagnostic experiment; it is not the
  recommended production fix because it changes throughput or kernel paths.
- The GPU compose profile pins the llama.cpp CUDA image by digest. Do not
  replace it with a floating `:server-cuda` tag unless the new digest has been
  stress-tested on the local GPU.
- GPU mode disables `SURYA_GUIDED_LAYOUT` because the current llama.cpp grammar
  parser rejects Surya's layout schema escape syntax. Layout/block bounding
  boxes remain enabled; only constrained JSON decoding is disabled.
- The OCR service probes the sidecar health endpoint before inference and uses a
  bounded exponential backoff during model reloads. `GET /health` reports the
  current inference state, detected recoveries, a `sidecar_generation` counter,
  the last request/page indexes, and safe CUDA error metadata.
- **CPU fallback**: for a guaranteed CPU run, use `npm run stack:up` (this
  override is simply not applied).
- The active device shows in `GET /info` (`device: gpu`) and the UI chip.
- The GGUF is referenced by its content-addressed `blobs/<sha256>` path; update
  the two hashes in `docker-compose.gpu.yml` if the model is re-downloaded to a
  new snapshot.

## Large documents & the page limit

`MAX_PAGES` (default 50) caps a **single** `/api/v1/marker` request — it is a
safety bound, not the maximum document size. The web app inspects the PDF page
count, splits large documents into contiguous chunks of `CHUNK_SIZE` pages
(default 25, always ≤ `MAX_PAGES`), parses the chunks (sequentially on CPU, up
to `INFERENCE_CONCURRENCY` in parallel on GPU), shows real progress, and merges
the pages back in original order. So there is effectively no total page limit;
only each request stays bounded. The web app reads `GET /info` to size chunks
and display the active backend.

## Endpoints

- `GET /health` — liveness plus inference state · `GET /ready` — readiness (503 until warmed)
- `GET /info` — `{ backend, model, max_pages, chunk_size, concurrency, max_upload_bytes }`
- `POST /api/v1/marker` — parse (form: `file`, `output_format=json`,
  `page_range`, `skip_cache`, `keep_header`, `keep_footer`)

## Start from repository root

```bash
docker compose up --build
```

### Intermittent CUDA failure diagnostics

The llama.cpp traceback may end at `cudaStreamSynchronize` even though the
original asynchronous kernel failure occurred earlier. Preserve the model and
launch flags while collecting evidence:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml logs --timestamps --tail=300 llama-cuda surya-ocr
nvidia-smi -q -d ECC,POWER,TEMPERATURE,PERFORMANCE,PCI
nvidia-smi --query-gpu=timestamp,name,driver_version,pstate,temperature.gpu,power.draw,memory.used,memory.total --format=csv
```

On Linux/WSL hosts, also inspect the matching time window for NVIDIA `Xid`,
PCIe, ECC, or GPU-reset events (`dmesg`/`journalctl`). On Windows hosts, use
Event Viewer and the NVIDIA driver logs. The OCR service records only document
hashes, request IDs, page indexes, error codes, and message fingerprints; raw
document content is not logged.

For a reproducible case, replay the smallest failing page range with the same
image digest and flags. If no host fault is present, compare a stress-tested
llama.cpp image digest in staging and promote it only after repeated cold/warm
replays preserve OCR output and page latency.

Then open `http://localhost:3000`.

The OCR service is internal-only. For direct access (docs, smoke tests),
start the debug proxy:

```bash
docker compose --profile debug up ocr-debug-proxy
```

- `http://localhost:8081/health`
- `http://localhost:8081/docs`

Override the host port with `OCR_HOST_PORT` in `.env`.

## Quick Python Smoke Test

This repo includes `test_surya_ocr.py` to verify OCR is running.

Run from `backend/ocr` (with the debug proxy up):

```bash
python test_surya_ocr.py --mode api --endpoint http://localhost:8081/api/v1/marker
```

This will:

- download a sample image (if missing)
- call the OCR endpoint and assert the `pages[].blocks[]` contract
- save response JSON to `sample/smoke_output.json`

To test direct model inference (no API — requires backend requirements
installed and `llama-server` on PATH or `SURYA_INFERENCE_URL` set):

```bash
python test_surya_ocr.py --mode direct
```

### Run Test Inside Docker Container

After `docker compose up --build`, run from repo root:

```bash
docker compose cp backend/ocr/test_surya_ocr.py surya-ocr:/tmp/test_surya_ocr.py
docker compose exec surya-ocr python /tmp/test_surya_ocr.py --mode api --endpoint http://localhost:8080/api/v1/marker --image /tmp/sample.png --save-json /tmp/smoke_output.json
```

(The test script is intentionally not baked into the production image.)

## Performance expectations

- Surya 2 scores 83.3 on olmOCR-bench (Chandra OCR 2: 85.9) at ~6× smaller size.
- CPU (llama.cpp) inference is slow — roughly tens of seconds per page
  depending on hardware. Use `page_range` for large documents, or a GPU vLLM
  backend for production throughput.
