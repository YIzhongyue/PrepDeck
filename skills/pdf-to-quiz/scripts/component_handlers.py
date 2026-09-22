"""Component assembly handlers consume selected evidence blocks, not exam names.

The segmentation plan chooses which blocks belong together. It must retain the
case context; these handlers never decide question boundaries or answer keys.
"""

import base64
from pathlib import Path


def text_part(spec, blocks, root):
    return {**spec, "text": "\n".join(b.get("text", "") for b in blocks).strip()}


def table_part(spec, blocks, root):
    if len(blocks) != 1 or blocks[0].get("kind") != "table":
        raise ValueError("table handler needs one structured table block")
    data = blocks[0]["table"]
    rows = data["num_rows"]
    cols = data["num_cols"]
    grid = [[""] * cols for _ in range(rows)]
    for cell in data["table_cells"]:
        if cell.get("row_span", 1) != 1 or cell.get("col_span", 1) != 1:
            raise ValueError(
                "merged table cells require a reviewed figure or explicit unmerged transcription"
            )
        grid[cell["start_row_offset_idx"]][cell["start_col_offset_idx"]] = cell["text"]
    headers = spec.pop("headerRows", 0)
    if headers not in (0, 1):
        raise ValueError("headerRows must be 0 or 1")
    columns = grid.pop(0) if headers else spec.get("columns")
    if not columns:
        raise ValueError(
            "specify column labels or explicitly mark the first header row"
        )
    return {**spec, "columns": columns, "rows": grid}


def figure_part(spec, blocks, root):
    if len(blocks) != 1 or not blocks[0].get("asset"):
        raise ValueError("figure needs retained image pixels")
    path = (root / blocks[0]["asset"]).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("image must remain inside evidence workspace")
    from PIL import Image
    import io

    with Image.open(path) as image:
        # The source crop stays unchanged on disk. Portable assets use a bounded
        # display copy; the reviewer checks that essential detail remains legible.
        image = image.convert("RGB")
        image.thumbnail((1600, 1600))
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        if len(output.getvalue()) > 262144:
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=85, optimize=True)
            mime = "image/jpeg"
        else:
            mime = "image/png"
        if len(output.getvalue()) > 262144:
            raise ValueError(
                "figure exceeds asset limit; provide a reviewed smaller crop"
            )
    asset = {
        "id": spec["assetId"],
        "mediaType": mime,
        "data": base64.b64encode(output.getvalue()).decode(),
    }
    return spec, asset


HANDLERS = {
    "paragraph": text_part,
    "heading": text_part,
    "code": text_part,
    "table": table_part,
    "figure": figure_part,
}


def assemble_component(spec, document, root):
    spec = dict(spec)
    refs = spec.pop("sourceBlocks")
    index = {b["id"]: b for p in document["pages"] for b in p["blocks"]}
    if not refs or any(r not in index for r in refs):
        raise ValueError("unknown or empty source block references")
    blocks = [index[r] for r in refs]
    spec["sources"] = [
        {"documentId": document["documentId"], "page": b["page"], "bbox": b.get("bbox")}
        for b in blocks
    ]
    handler = HANDLERS.get(spec["type"])
    if not handler:
        raise ValueError(
            "no automatic handler for this component; provide a reviewed explicit component"
        )
    result = handler(spec, blocks, Path(root))
    return result if isinstance(result, tuple) else (result, None)
