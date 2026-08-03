import asyncio
from types import SimpleNamespace
import unittest

from app.inference_runtime import release_request, reserve_request


class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_reservation_never_exceeds_capacity(self):
        state = SimpleNamespace(queue_depth=0, queue_lock=asyncio.Lock())
        accepted = await asyncio.gather(*(reserve_request(state, 2) for _ in range(5)))
        self.assertEqual(sum(accepted), 2)
        await asyncio.gather(*(release_request(state) for accepted_one in accepted if accepted_one))
        self.assertEqual(state.queue_depth, 0)


if __name__ == "__main__":
    unittest.main()
