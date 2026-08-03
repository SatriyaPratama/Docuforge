# syntax=docker/dockerfile:1

# ── Stage 1: fetch a pinned llama.cpp release (llama-server + shared libs) ──
FROM debian:bookworm-slim AS llama
ARG LLAMA_CPP_TAG=b10201
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/llama.tar.gz \
        "https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-ubuntu-x64.tar.gz" \
    && mkdir -p /opt/llama /staged \
    && tar -xzf /tmp/llama.tar.gz -C /opt/llama \
    && rm /tmp/llama.tar.gz \
    # Release tarball layout varies across tags — locate instead of assuming paths.
    # IMPORTANT: llama-server and the ggml backend .so files MUST live in the
    # same directory: ggml discovers CPU backends by scanning the executable's
    # own directory (plain ld.so lookup is not enough).
    && find /opt/llama -type f -name 'llama-server' -exec cp {} /staged/ \; \
    && find /opt/llama -name '*.so*' -exec cp -P {} /staged/ \; \
    && chmod +x /staged/llama-server \
    && test -x /staged/llama-server

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Surya 2 serves its VLM through llama.cpp in-container by default;
    # GPU deployments override with SURYA_INFERENCE_BACKEND=vllm + SURYA_INFERENCE_URL.
    SURYA_INFERENCE_BACKEND=llamacpp \
    SURYA_INFERENCE_KEEP_ALIVE=1 \
    SURYA_INFERENCE_PARALLEL=4 \
    PATH="/opt/llama:${PATH}"

# libgomp1 is required by llama.cpp CPU builds; curl kept for debugging probes.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

# llama-server + ggml backend plugins + shared libs, all co-located in /opt/llama
# (see note in the build stage) and resolvable by the dynamic linker.
COPY --from=llama /staged/ /opt/llama/
RUN echo /opt/llama > /etc/ld.so.conf.d/llama.conf && ldconfig \
    && llama-server --version

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Non-root runtime user; /data holds model caches and results (volume-mounted).
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /data/hf /data/torch /data/cache /data/documents \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
