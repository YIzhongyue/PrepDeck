"""Shared PDF layout catalog, shipped with the standalone skill."""
import json
from pathlib import Path

CATALOG = json.loads((Path(__file__).resolve().parents[1] / "references/pdf-layouts.json").read_text(encoding="utf-8"))
LAYOUTS = {item["id"]: item for item in CATALOG["layouts"]}


def get_layout(identity: str) -> dict:
    if identity not in LAYOUTS:
        raise ValueError(f"Unknown layout {identity!r}; choose from {', '.join(LAYOUTS)}")
    return LAYOUTS[identity]
