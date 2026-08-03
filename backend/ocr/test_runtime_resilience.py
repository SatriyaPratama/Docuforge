"""Regression checks for GPU-sidecar failure classification and recovery state."""

import unittest
from types import SimpleNamespace

from app.inference_runtime import (
    initial_inference_status,
    record_inference_event,
    inference_failure,
    inference_http_status,
    inference_failure_context,
)


class RuntimeResilienceTests(unittest.TestCase):
    def test_failure_categories_are_actionable(self):
        cases = {
            "CUDA error: an illegal instruction was encountered": "cuda_illegal_instruction",
            "12.17.264.702 E cudaStreamSynchronize: CUDA error": "cuda_runtime_error",
            "CUDA error: an illegal memory access was encountered": "cuda_illegal_memory_access",
            "CUDA out of memory": "gpu_oom",
            "503 Loading model": "inference_unavailable",
            "failed to parse grammar: unknown escape": "grammar_error",
        }
        for message, expected_event in cases.items():
            _detail, event = inference_failure(RuntimeError(message))
            self.assertEqual(event, expected_event, message)

    def test_transient_gpu_failures_are_503s(self):
        for event in (
            "gpu_oom",
            "inference_unavailable",
            "cuda_illegal_instruction",
            "cuda_illegal_memory_access",
            "cuda_runtime_error",
        ):
            self.assertEqual(inference_http_status(event), 503)
        self.assertEqual(inference_http_status("grammar_error"), 502)

    def test_cuda_context_preserves_page_context_without_raw_message(self):
        detail, event, context = inference_failure_context(
            RuntimeError("CUDA error: an illegal memory access was encountered")
        )
        self.assertEqual(event, "cuda_illegal_memory_access")
        self.assertIn("GPU OCR server", detail)
        self.assertEqual(context["cuda_error_code"], "illegal_memory_access")
        self.assertTrue(context["message_fingerprint"])
        self.assertNotIn("illegal memory access", context["message_fingerprint"])

    def test_detected_restart_counts_only_after_ready_state(self):
        state = SimpleNamespace(inference_status=initial_inference_status())

        record_inference_event(state, "inference_waiting", "startup")
        record_inference_event(state, "inference_ready")
        self.assertEqual(state.inference_status["detected_recoveries"], 0)

        record_inference_event(state, "inference_unavailable", "http_503")
        record_inference_event(
            state,
            "cuda_runtime_error",
            "CUDA kernel failure",
            request_id="request-7",
            page_indexes=[12],
            attempt=1,
            cuda_error_code="runtime_error",
        )
        record_inference_event(state, "inference_ready")
        self.assertEqual(state.inference_status["detected_recoveries"], 1)
        self.assertEqual(state.inference_status["sidecar_generation"], 1)
        self.assertEqual(state.inference_status["last_request_id"], "request-7")
        self.assertEqual(state.inference_status["last_page_indexes"], [12])
        self.assertEqual(state.inference_status["last_attempt"], 1)
        self.assertEqual(state.inference_status["last_error_code"], "runtime_error")

    def test_kernel_failure_alone_does_not_claim_a_sidecar_restart(self):
        state = SimpleNamespace(inference_status=initial_inference_status())
        record_inference_event(state, "inference_ready")
        record_inference_event(state, "cuda_runtime_error", "kernel failure")
        record_inference_event(state, "inference_ready")
        self.assertEqual(state.inference_status["sidecar_generation"], 0)


if __name__ == "__main__":
    unittest.main()
