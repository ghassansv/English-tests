from pathlib import Path
import unittest

import services.document_intelligence_service as service


class LoadFailsPaddle(service.PaddleOCRVLProvider):
    def check_dependencies(self):
        return None

    def check_device(self):
        self.state.device = "cuda"

    def load_model(self):
        self.fail("model-load-failed", "fake load failure")


class SmokeFailsPaddle(service.PaddleOCRVLProvider):
    def check_dependencies(self):
        return None

    def check_device(self):
        self.state.device = "cuda"

    def load_model(self):
        self.pipeline = object()
        self.state.modelLoaded = True

    def predict_raw(self, image_path, max_new_tokens=None):
        return [{"json": {"width": 100, "height": 100, "parsing_res_list": []}}]


class DocumentIntelligenceServiceTests(unittest.TestCase):
    def test_model_load_failure_is_not_ready(self):
        provider = LoadFailsPaddle()
        with self.assertRaises(service.ProviderFailure) as raised:
            provider.ensure_ready(Path(__file__))
        self.assertEqual(raised.exception.reason, "model-load-failed")
        health = provider.health()
        self.assertFalse(health["available"])
        self.assertEqual(health["state"], "model-load-failed")
        self.assertEqual(health["failureReason"], "model-load-failed")

    def test_smoke_failure_is_not_ready(self):
        provider = SmokeFailsPaddle()
        with self.assertRaises(service.ProviderFailure) as raised:
            provider.ensure_ready(Path(__file__))
        self.assertEqual(raised.exception.reason, "smoke-inference-failed")
        health = provider.health()
        self.assertFalse(health["available"])
        self.assertTrue(health["modelLoaded"])
        self.assertFalse(health["smokeTestPassed"])

    def test_paddle_mapping_preserves_missing_confidence(self):
        raw = [
            {
                "json": {
                    "width": 1000,
                    "height": 2000,
                    "parsing_res_list": [
                        {
                            "block_label": "text",
                            "block_content": "A real text block",
                            "block_bbox": [100, 200, 500, 300],
                            "block_order": 1,
                        },
                        {
                            "block_label": "table",
                            "block_content": "",
                            "block_bbox": [100, 400, 900, 800],
                            "confidence": 0.83,
                        },
                    ],
                }
            }
        ]
        analysis = service.map_paddle_raw_to_analysis(raw, Path(__file__), "PaddleOCR-VL-1.6", "cuda")
        self.assertEqual(analysis["schemaVersion"], "document-provider-analysis/v1")
        self.assertEqual(len(analysis["elements"]), 2)
        self.assertIsNone(analysis["elements"][0]["confidence"])
        self.assertEqual(analysis["elements"][0]["sourceBBox"]["coordinateSpace"], "source-document-plane-normalized")
        self.assertEqual(analysis["visualClassifications"][0]["classification"], "table")

    def test_paddle_mapping_accepts_string_blocks_with_layout_boxes(self):
        raw = [
            {
                "width": 1000,
                "height": 2000,
                "parsing_res_list": [
                    "\n\n#################\nlabel:\ttext\nbbox:\t[100, 200, 500, 300]\ncontent:\tA paragraph\n#################",
                    "\n\n#################\nlabel:\timage\nbbox:\t[100, 400, 900, 800]\ncontent:\t\n#################",
                ],
                "layout_det_res": {
                    "boxes": [
                        {"label": "text", "score": 0.91, "coordinate": [100, 200, 500, 300], "order": 1},
                        {"label": "image", "score": 0.82, "coordinate": [100, 400, 900, 800]},
                    ]
                },
            }
        ]
        analysis = service.map_paddle_raw_to_analysis(raw, Path(__file__), "PaddleOCR-VL-1.6", "cuda")
        self.assertEqual(len(analysis["elements"]), 2)
        self.assertEqual(analysis["elements"][0]["text"], "A paragraph")
        self.assertEqual(analysis["elements"][0]["confidence"], 0.91)
        self.assertEqual(analysis["elements"][1]["providerType"], "image")
        self.assertIsNone(analysis["elements"][1]["text"])
        self.assertEqual(analysis["diagnostics"]["detectedImageRegionCount"], 1)

    def test_text_only_qwen_model_is_not_accepted_as_vision_reasoner(self):
        self.assertFalse(service.is_vision_model_identifier("Qwen/Qwen3-8B-Instruct"))
        self.assertTrue(service.is_vision_model_identifier("Qwen/Qwen3-VL-8B-Instruct"))

    def test_unavailable_provider_failure_is_structured(self):
        analysis = service.unavailable_vision_analysis("cuda-out-of-memory", "fake oom")
        self.assertFalse(analysis["diagnostics"]["available"])
        self.assertEqual(analysis["diagnostics"]["failureReason"], "cuda-out-of-memory")
        self.assertIsNone(analysis["page"]["confidence"])

    def test_qwen_json_extractor_repairs_missing_field_commas(self):
        raw = """```json
{
  "schemaVersion": "vision-document-analysis/v1"
  "page": {
    "orientation": "upright"
    "pageType": "article"
    "columnCount": 2
  }
  "readingOrderEvidence": []
}
```"""
        parsed = service.extract_json_object(raw)
        self.assertEqual(parsed["schemaVersion"], "vision-document-analysis/v1")
        self.assertEqual(parsed["page"]["columnCount"], 2)
        self.assertGreaterEqual(parsed["_jsonRepairAttempts"], 1)

    def test_qwen_json_extractor_repairs_truncated_reading_order_fixture(self):
        fixture = Path(__file__).parent / "fixtures" / "qwen_truncated_reading_order_raw.txt"
        raw = fixture.read_text(encoding="utf-8")
        parsed = service.extract_json_object(raw)
        self.assertEqual(parsed["schemaVersion"], "vision-document-analysis/v1")
        self.assertEqual(parsed["page"]["orientation"], "portrait")
        self.assertEqual(len(parsed["page"]["readingOrder"]), 1)
        self.assertGreaterEqual(parsed["_jsonRepairAttempts"], 1)

        normalized = service.normalize_vision_result(parsed, "Qwen/Qwen3-VL-8B-Instruct", "cuda", "none")
        self.assertEqual(normalized["schemaVersion"], "vision-document-analysis/v1")
        self.assertEqual(normalized["page"]["columnCount"], 2)
        self.assertEqual(len(normalized["groups"]), 1)
        self.assertEqual(normalized["readingOrderEvidence"], ["paragraph-1:paragraph"])
        self.assertTrue(normalized["diagnostics"]["schemaValidation"]["valid"])


if __name__ == "__main__":
    unittest.main()
