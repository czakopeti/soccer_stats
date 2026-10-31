"""Load the single tuning file."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "model.json"


def load_config(path: Path | None = None) -> dict:
    path = path or CONFIG_PATH
    with path.open(encoding="utf-8") as fh:
        cfg = json.load(fh)
    if "ratings" not in cfg or "elo" not in cfg or "thresholds" not in cfg:
        raise SystemExit(f"Model config at {path} is missing required sections.")
    return cfg


def get(cfg: dict, dotted: str):
    cur = cfg
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            raise KeyError(f"Missing config value: {dotted}")
        cur = cur[part]
    return cur
