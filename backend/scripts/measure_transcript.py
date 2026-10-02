"""Measure transcript endpoint response size and latency without storing payloads."""

from __future__ import annotations

import argparse
import statistics
import time
import urllib.request


def percentile(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentile)))
    return ordered[index]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--token")
    parser.add_argument("--samples", type=int, default=20)
    args = parser.parse_args()
    if args.samples < 1:
        parser.error("--samples must be at least 1")

    headers = {"Authorization": f"Bearer {args.token}"} if args.token else {}
    latencies_ms: list[float] = []
    sizes_bytes: list[int] = []
    for _ in range(args.samples):
        request = urllib.request.Request(args.url, headers=headers)
        started_at = time.perf_counter()
        with urllib.request.urlopen(request) as response:  # noqa: S310 - URL is operator supplied.
            sizes_bytes.append(len(response.read()))
        latencies_ms.append((time.perf_counter() - started_at) * 1000)

    print(
        {
            "samples": args.samples,
            "response_size_bytes": {"min": min(sizes_bytes), "max": max(sizes_bytes)},
            "latency_ms": {
                "p50": round(percentile(latencies_ms, 0.50), 2),
                "p95": round(percentile(latencies_ms, 0.95), 2),
                "mean": round(statistics.mean(latencies_ms), 2),
            },
        }
    )


if __name__ == "__main__":
    main()
