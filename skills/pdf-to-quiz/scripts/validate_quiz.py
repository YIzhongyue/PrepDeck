#!/usr/bin/env python3
"""Validate a PrepDeck schemaVersion 1.0 question import file."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

TYPES = {"single_choice", "multiple_choice", "true_false", "fill_blank"}
DIFFICULTIES = {"easy", "medium", "hard"}
PLACEHOLDER = re.compile(r"\b(?:TODO|TBD|UNKNOWN|PLACEHOLDER)\b", re.IGNORECASE)
TIMESTAMP = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?"
    r"(?:[Zz]|[+-](\d{2}):(\d{2}))$", re.ASCII
)
# Mirror packages/shared/src/import-validate.ts; cross-language tests check these.
IMPORT_LIMITS = {
    "maxQuestions": 1000, "maxStemLength": 20000, "maxOptionTextLength": 10000,
    "maxOptions": 20, "maxTags": 50, "maxTagLength": 200, "maxExplanationLength": 50000,
    "maxPoints": 100,
}
IMPORT_BODY_MAX_BYTES = 5 * 1024 * 1024
IMPORT_JSON_MAX_DEPTH = 32


def utf16_length(text: str) -> int:
    """Match the Worker's JavaScript string.length, including astral characters."""
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def check_transport(raw: str) -> None:
    if len(raw.encode("utf-8")) > IMPORT_BODY_MAX_BYTES:
        raise ValueError(f"import JSON exceeds {IMPORT_BODY_MAX_BYTES} UTF-8 bytes; split the import")
    depth, in_string, escaped = 0, False, False
    for char in raw:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            if depth > IMPORT_JSON_MAX_DEPTH:
                raise ValueError(f"JSON nesting must not exceed {IMPORT_JSON_MAX_DEPTH} levels")
        elif char in "]}":
            depth -= 1


def valid_timestamp(value: str) -> bool:
    """RFC 3339 date-time, range-checked here rather than by the interpreter.

    This deliberately does not call ``datetime.fromisoformat``. What that
    function accepts is a moving target — CPython 3.14 began accepting the
    end-of-day form ``24:00:00`` and normalising it to 00:00 the next day, so
    a timestamp the Worker rejects passed offline validation and only failed
    once the author tried to import the file. Delegating the contract to the
    standard library means the contract is whatever this interpreter happens to
    do this year, and a false *pass* is the expensive direction here.

    Mirrors ``validTimestamp`` in packages/shared/src/import-validate.ts field
    for field; tests/fixtures/import-contract.json is the shared contract both
    implementations are checked against.
    """
    match = TIMESTAMP.fullmatch(value)
    if not match:
        return False
    year, month, day, hour, minute, second, offset_hour, offset_minute = match.groups()
    y, m, d = int(year), int(month), int(day)
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    days = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    return (
        y >= 1
        and 1 <= m <= 12
        and 1 <= d <= days[m - 1]
        and int(hour) < 24
        and int(minute) < 60
        and int(second) < 60
        and int(offset_hour or 0) < 24
        and int(offset_minute or 0) < 60
    )


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and re.search(r"[^\s\u0085\u001c-\u001f\ufeff]", value) is not None


def validate(data: Any) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(data, dict):
        return (["$: must be an object"], warnings)
    if data.get("schemaVersion") == "2.0":
        try:
            from components import validate_components
            return validate_components(data), warnings
        except ImportError:
            return ["Component validation requires jsonschema: pip install 'jsonschema>=4,<5'"], warnings
    if data.get("schemaVersion") != "1.0":
        errors.append('$.schemaVersion: must be "1.0"')
    exam = data.get("exam")
    if not isinstance(exam, dict):
        errors.append("$.exam: must be an object")
    else:
        for field in ("id", "name"):
            if not nonempty(exam.get(field)):
                errors.append(f"$.exam.{field}: must be a non-empty string")
        for field in ("subject", "language"):
            if field in exam and not isinstance(exam[field], str):
                errors.append(f"$.exam.{field}: must be a string")
    source = data.get("source")
    if "source" in data:
        if not isinstance(source, dict):
            errors.append("$.source: must be an object")
        else:
            for field in ("originalFileName", "extractedBy", "extractedAt"):
                if field in source and not isinstance(source[field], str):
                    errors.append(f"$.source.{field}: must be a string")
            timestamp = source.get("extractedAt")
            if isinstance(timestamp, str):
                if not valid_timestamp(timestamp):
                    errors.append("$.source.extractedAt: must be an RFC 3339 date-time")
    questions = data.get("questions")
    if not isinstance(questions, list) or not questions:
        errors.append("$.questions: must be a non-empty array")
        return errors, warnings
    if len(questions) > IMPORT_LIMITS["maxQuestions"]:
        errors.append(f"$.questions: must contain at most {IMPORT_LIMITS['maxQuestions']} questions")
        return errors, warnings
    external_ids: set[str] = set()
    for index, question in enumerate(questions):
        path = f"$.questions[{index}]"
        if not isinstance(question, dict):
            errors.append(f"{path}: must be an object")
            continue
        question_type = question.get("type")
        if not isinstance(question_type, str) or question_type not in TYPES:
            errors.append(f"{path}.type: must be one of {', '.join(sorted(TYPES))}")
            question_type = None
        if not nonempty(question.get("stem")):
            errors.append(f"{path}.stem: must be a non-empty string")
        elif utf16_length(question["stem"]) > IMPORT_LIMITS["maxStemLength"]:
            errors.append(f"{path}.stem: exceeds {IMPORT_LIMITS['maxStemLength']} UTF-16 code units")
        external_id = question.get("externalId")
        if "externalId" in question and not nonempty(external_id):
            errors.append(f"{path}.externalId: must be a non-empty string")
        elif external_id:
            if external_id in external_ids:
                errors.append(f'{path}.externalId: duplicate "{external_id}"')
            external_ids.add(external_id)
        answers = question.get("correctAnswers")
        if not isinstance(answers, list) or not answers or any(not nonempty(answer) for answer in answers):
            errors.append(f"{path}.correctAnswers: must be a non-empty array of non-empty strings")
            answers = []
        elif len(answers) != len(set(answers)):
            errors.append(f"{path}.correctAnswers: must not contain duplicates")
        options = question.get("options")
        option_ids: list[str] = []
        if question_type == "fill_blank":
            if "options" in question:
                errors.append(f"{path}.options: must be omitted for fill_blank")
        elif question_type in TYPES:
            if not isinstance(options, list) or not options:
                errors.append(f"{path}.options: must be a non-empty array for choice types")
            else:
                if question_type == "single_choice" and len(options) < 2:
                    errors.append(f"{path}.options: single_choice requires at least two options")
                if len(options) > IMPORT_LIMITS["maxOptions"]:
                    errors.append(f"{path}.options: must contain at most {IMPORT_LIMITS['maxOptions']} options")
                for option_index, option in enumerate(options):
                    option_path = f"{path}.options[{option_index}]"
                    if not isinstance(option, dict) or not nonempty(option.get("id")) or not nonempty(option.get("text")):
                        errors.append(f"{option_path}: id and text must be non-empty strings")
                    else:
                        option_ids.append(option["id"])
                        if utf16_length(option["text"]) > IMPORT_LIMITS["maxOptionTextLength"]:
                            errors.append(f"{option_path}.text: exceeds {IMPORT_LIMITS['maxOptionTextLength']} UTF-16 code units")
                if len(option_ids) != len(set(option_ids)):
                    errors.append(f"{path}.options: option ids must be unique")
                for answer in answers:
                    if answer not in option_ids:
                        errors.append(f'{path}.correctAnswers: "{answer}" does not match an option id')
        if question_type == "single_choice" and len(answers) != 1:
            errors.append(f"{path}.correctAnswers: single_choice requires exactly one answer")
        if question_type == "multiple_choice" and len(answers) < 2:
            errors.append(f"{path}.correctAnswers: multiple_choice requires at least two answers")
        if question_type == "true_false":
            if set(option_ids) != {"true", "false"} or len(option_ids) != 2:
                errors.append(f'{path}.options: true_false requires exactly ids "true" and "false"')
            if len(answers) != 1 or any(answer not in {"true", "false"} for answer in answers):
                errors.append(f'{path}.correctAnswers: true_false requires exactly "true" or "false"')
        explanation = question.get("explanation")
        if explanation is not None and not isinstance(explanation, str):
            errors.append(f"{path}.explanation: must be a string or null")
        elif isinstance(explanation, str) and utf16_length(explanation) > IMPORT_LIMITS["maxExplanationLength"]:
            errors.append(f"{path}.explanation: exceeds {IMPORT_LIMITS['maxExplanationLength']} UTF-16 code units")
        difficulty = question.get("difficulty")
        if difficulty is not None and (not isinstance(difficulty, str) or difficulty not in DIFFICULTIES):
            errors.append(f"{path}.difficulty: must be easy, medium, hard, or null")
        tags = question.get("tags")
        if "tags" in question and (not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags)):
            errors.append(f"{path}.tags: must be an array of strings")
        elif isinstance(tags, list):
            if len(tags) > IMPORT_LIMITS["maxTags"]:
                errors.append(f"{path}.tags: must contain at most {IMPORT_LIMITS['maxTags']} tags")
            for tag_index, tag in enumerate(tags):
                if utf16_length(tag) > IMPORT_LIMITS["maxTagLength"]:
                    errors.append(f"{path}.tags[{tag_index}]: exceeds {IMPORT_LIMITS['maxTagLength']} UTF-16 code units")
        # Optional import-workflow flag (issue #15): the application stores it
        # on the question row, not as a tag. This pipeline never emits it —
        # unresolved questions stay in the review artifact rather than being
        # exported flagged — but the contract this validator mirrors accepts it.
        if "needsReview" in question and not isinstance(question.get("needsReview"), bool):
            errors.append(f"{path}.needsReview: must be a boolean")
        points = question.get("points")
        if "points" in question and (
            isinstance(points, bool) or not isinstance(points, (int, float))
            or (isinstance(points, float) and not math.isfinite(points))
            or not 0 < points <= IMPORT_LIMITS["maxPoints"]
        ):
            errors.append(f"{path}.points: must be a number greater than 0 and at most {IMPORT_LIMITS['maxPoints']}")
        for field in ("stem", "explanation"):
            value = question.get(field)
            if isinstance(value, str) and PLACEHOLDER.search(value):
                warnings.append(f"{path}.{field}: contains an uncertainty placeholder")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json_file", type=Path)
    args = parser.parse_args()
    try:
        if args.json_file.stat().st_size > IMPORT_BODY_MAX_BYTES:
            raise ValueError(f"import JSON exceeds {IMPORT_BODY_MAX_BYTES} bytes")
        raw = args.json_file.read_text(encoding="utf-8")
        check_transport(raw)
        data = json.loads(raw)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    errors, warnings = validate(data)
    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    questions = data.get("questions") if isinstance(data, dict) else None
    print(f"Validated {len(questions) if isinstance(questions, list) else 0} question(s): "
          f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
