"""Local document parsing profiles, separate from the application question schema."""

import json
from pathlib import Path

CATALOG = json.loads(
    (Path(__file__).resolve().parents[1] / "references/pdf-layouts.json").read_text(
        encoding="utf-8"
    )
)
LAYOUTS = {item["id"]: item for item in CATALOG["layouts"]}


def load_profiles(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    for item in data["layouts"]:
        if not isinstance(item.get("id"), str):
            raise ValueError("profile needs an id")
        LAYOUTS[item["id"]] = item
    return data


def get_layout(identity):
    if identity not in LAYOUTS:
        raise ValueError(
            f"Unknown profile {identity!r}; supply --profiles or choose {', '.join(LAYOUTS)}"
        )
    return LAYOUTS[identity]
