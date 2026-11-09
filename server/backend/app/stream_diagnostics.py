"""Opt-in HTTP Range tracing for AVPlayer startup/seek investigations.

Never log raw paths, URLs, authorization headers, signed tokens or song IDs.
Enabled only when STREAM_TRACE=true in the bridge environment.
"""
import hashlib
import logging
import re
import time
import uuid

log = logging.getLogger("uvicorn.error")
_RANGE = re.compile(r"^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$")
_CONTENT_RANGE = re.compile(r"^bytes [0-9]+-[0-9]+/[0-9*]+$")


def safe_range(value: str | None) -> str:
    if value is None:
        return "none"
    return value if len(value) <= 80 and _RANGE.fullmatch(value) else "invalid"


def safe_content_range(value: str | None) -> str:
    if value is None:
        return "none"
    return value if len(value) <= 100 and _CONTENT_RANGE.fullmatch(value) else "invalid"


def song_tag(song_id: str) -> str:
    return hashlib.sha256(song_id.encode("utf-8")).hexdigest()[:12]


def trace_context(song_id: str, requested_range: str | None) -> dict:
    return {
        "id": uuid.uuid4().hex[:8],
        "song": song_tag(song_id),
        "request_range": safe_range(requested_range),
        "started": time.perf_counter(),
    }


def trace_headers(ctx: dict, status: int, headers) -> None:
    ctx["headers_ms"] = (time.perf_counter() - ctx["started"]) * 1000
    ctx["status"] = status
    ctx["content_range"] = safe_content_range(headers.get("content-range"))
    ctx["accept_ranges"] = headers.get("accept-ranges", "") == "bytes"
    log.warning(
        "STREAM_TRACE phase=headers req=%s song=%s range=%s status=%d content_range=%s "
        "accept_ranges=%s upstream_headers_ms=%.1f",
        ctx["id"], ctx["song"], ctx["request_range"], status, ctx["content_range"],
        ctx["accept_ranges"], ctx["headers_ms"],
    )


def trace_failure(ctx: dict, status: int) -> None:
    log.warning(
        "STREAM_TRACE phase=error req=%s song=%s range=%s status=%d elapsed_ms=%.1f",
        ctx["id"], ctx["song"], ctx["request_range"], status,
        (time.perf_counter() - ctx["started"]) * 1000,
    )


async def traced_bytes(source, ctx: dict):
    total = 0
    first_ms = None
    completed = False
    try:
        async for chunk in source:
            if first_ms is None:
                first_ms = (time.perf_counter() - ctx["started"]) * 1000
            total += len(chunk)
            yield chunk
        completed = True
    finally:
        log.warning(
            "STREAM_TRACE phase=finished req=%s song=%s range=%s status=%d "
            "first_byte_ms=%s transferred_bytes=%d total_ms=%.1f completed=%s",
            ctx["id"], ctx["song"], ctx["request_range"], ctx.get("status", 0),
            ("%.1f" % first_ms) if first_ms is not None else "none", total,
            (time.perf_counter() - ctx["started"]) * 1000, completed,
        )
