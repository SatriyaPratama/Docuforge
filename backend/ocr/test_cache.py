import tempfile
import unittest

from app.result_cache import ResultCache


class ResultCacheTests(unittest.TestCase):
    def test_key_is_stable_and_cached_pages_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = ResultCache(directory, "surya-ocr-2-boxes-v1")
            cache.ensure_directory()
            key = cache.key("a" * 64, [0, 3])
            cache.write(key, [{"id": 0, "page_id": 0, "blocks": []}])
            self.assertEqual(cache.read(key), [{"id": 0, "page_id": 0, "blocks": []}])


if __name__ == "__main__":
    unittest.main()
