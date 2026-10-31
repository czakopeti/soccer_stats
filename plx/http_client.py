"""Small downloader with retries. 403 and 503 happen on the public feeds."""
from __future__ import annotations

import time
import urllib.error
import urllib.request


class DownloadError(RuntimeError):
    pass


def get_bytes(url: str, user_agent: str, timeout: int = 60, attempts: int = 6) -> bytes:
    last = "no attempt"
    for i in range(attempts):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json,text/csv,text/plain,*/*",
                "Accept-Language": "en",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code} for {url}"
            # Finished gameweeks on the FPL feed sometimes 403 when hit in a burst.
            if exc.code not in (403, 429, 500, 502, 503, 504):
                raise DownloadError(last) from exc
        except Exception as exc:  # noqa: BLE001 - network errors vary
            last = f"{type(exc).__name__}: {exc}"
        time.sleep(min(20, 1.5 ** i))
    raise DownloadError(f"Gave up after {attempts} tries. Last error: {last}")


def get_json(url: str, user_agent: str, timeout: int = 60) -> dict | list:
    import json

    raw = get_bytes(url, user_agent, timeout=timeout)
    return json.loads(raw.decode("utf-8"))
