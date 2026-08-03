"""Smoke test for the DocuForge Surya OCR backend.

Modes:
  api    - POST an image to the running FastAPI service (/api/v1/marker) and
           assert the pages[].blocks[] contract.
  direct - Run Surya OCR 2 in-process via SuryaInferenceManager +
           RecognitionPredictor (requires backend requirements installed and
           an inference backend: llama-server on PATH, or SURYA_INFERENCE_URL).
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

import httpx

SAMPLE_IMAGE_URL = "https://huggingface.co/datalab-to/chandra-ocr-2/resolve/main/handwritten_form.png"


def ensure_sample_image(path: Path) -> Path:
    if path.exists():
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"[test] downloading sample image: {SAMPLE_IMAGE_URL}")
    urllib.request.urlretrieve(SAMPLE_IMAGE_URL, str(path))
    return path


def run_api_mode(
    image_path: Path,
    endpoint: str,
    timeout_s: int,
    save_json: Path | None,
) -> int:
    with image_path.open("rb") as f:
        files = {
            "file": (image_path.name, f, "image/png"),
        }
        data = {
            "output_format": "json",
        }
        print(f"[api] POST {endpoint}")
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.post(endpoint, files=files, data=data)

    print(f"[api] status: {resp.status_code}")
    if resp.status_code != 200:
        print(resp.text)
        return 1

    payload = resp.json()
    pages = payload.get("pages", []) if isinstance(payload, dict) else []
    blocks = [b for p in pages if isinstance(p, dict) for b in p.get("blocks", [])]
    non_empty_html = sum(1 for b in blocks if b.get("html"))
    with_bbox = sum(1 for b in blocks if b.get("bbox"))

    print(f"[api] pages: {len(pages)}")
    print(f"[api] blocks: {len(blocks)}")
    print(f"[api] blocks with html: {non_empty_html}")
    print(f"[api] blocks with bbox: {with_bbox}")
    print(f"[api] meta: {payload.get('meta')}")

    if save_json:
        save_json.parent.mkdir(parents=True, exist_ok=True)
        save_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"[api] wrote: {save_json}")

    # Contract assertions
    if not pages:
        print("[api] FAIL: no pages returned")
        return 1
    if not blocks:
        print("[api] FAIL: no blocks returned")
        return 1
    if non_empty_html == 0:
        print("[api] FAIL: every block has empty html")
        return 1

    print("[api] OK")
    return 0


def run_direct_mode(
    image_path: Path,
    save_json: Path | None,
) -> int:
    try:
        from PIL import Image
        from surya.inference import SuryaInferenceManager
        from surya.recognition import RecognitionPredictor
    except ImportError as exc:
        print(f"[direct] missing dependency: {exc}")
        print("[direct] install backend requirements first.")
        return 1

    print("[direct] starting inference manager (spawns/attaches VLM server)")
    manager = SuryaInferenceManager()
    predictor = RecognitionPredictor(manager)

    image = Image.open(image_path)
    if image.mode != "RGB":
        image = image.convert("RGB")

    print("[direct] running full-page OCR")
    results = predictor([image])
    result = results[0]

    blocks = sorted(
        getattr(result, "blocks", []) or [],
        key=lambda b: getattr(b, "reading_order", 0) or 0,
    )
    print(f"[direct] blocks: {len(blocks)}")
    for block in blocks:
        label = getattr(block, "label", "?")
        html = getattr(block, "html", "") or ""
        skipped = getattr(block, "skipped", False)
        error = getattr(block, "error", False)
        confidence = getattr(block, "confidence", None)
        print(
            f"[direct]   {label:<16} html_chars={len(html):<6} "
            f"skipped={skipped} error={error} confidence={confidence}"
        )

    if save_json:
        serialized = [
            {
                "label": getattr(b, "label", None),
                "reading_order": getattr(b, "reading_order", None),
                "html": getattr(b, "html", None),
                "bbox": list(getattr(b, "bbox", []) or []),
                "confidence": getattr(b, "confidence", None),
                "skipped": getattr(b, "skipped", None),
                "error": getattr(b, "error", None),
            }
            for b in blocks
        ]
        save_json.parent.mkdir(parents=True, exist_ok=True)
        save_json.write_text(json.dumps(serialized, indent=2), encoding="utf-8")
        print(f"[direct] wrote: {save_json}")

    if not blocks:
        print("[direct] FAIL: no blocks returned")
        return 1

    print("[direct] OK")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Smoke test Surya OCR 2 (API mode or direct model mode)."
    )
    parser.add_argument("--mode", choices=["api", "direct"], default="api")
    parser.add_argument(
        "--image",
        default="./sample/handwritten_form.png",
        help="Path to input image. If missing, sample image is downloaded.",
    )

    parser.add_argument(
        "--endpoint",
        default="http://localhost:8081/api/v1/marker",
        help="OCR API endpoint (api mode). Default targets the debug proxy.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="HTTP timeout in seconds for api mode.",
    )
    parser.add_argument(
        "--save-json",
        default="./sample/smoke_output.json",
        help="Where to save output JSON.",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    image_path = Path(args.image).resolve()
    ensure_sample_image(image_path)
    save_json = Path(args.save_json).resolve() if args.save_json else None

    if args.mode == "api":
        return run_api_mode(
            image_path=image_path,
            endpoint=args.endpoint,
            timeout_s=args.timeout,
            save_json=save_json,
        )

    return run_direct_mode(image_path=image_path, save_json=save_json)


if __name__ == "__main__":
    sys.exit(main())
