"""Collect explicit answer evidence without guessing labels or resolving conflicts."""

import re


def collect(text, layout, answer_pattern=None):
    """Read numbered answer regions, with optional explicit conclusions inside them.

    Used only in separately scoped answer sections. A conclusion without a
    numbered header is deliberately unassigned, even on a continuation page.
    """
    pattern = re.compile(answer_pattern or layout["answerPattern"], re.M)
    raw = re.compile(
        layout.get("unreadableAnswerPattern", layout["questionPattern"]), re.M
    )
    valid = {m.start(): m for m in pattern.finditer(text)}
    headers = {m.start(): m for m in raw.finditer(text)}
    headers.update(valid)
    patterns = layout.get("answerConclusionPatterns", [])
    if layout.get("answerConclusionPattern"):
        patterns = [layout["answerConclusionPattern"], *patterns]
    conclusions = [re.compile(pattern, re.M) for pattern in patterns]
    if any(pattern.groups != 1 for pattern in conclusions):
        raise ValueError("answer conclusion patterns need exactly one label group")
    positions = sorted(headers)
    result = []
    for index, start in enumerate(positions):
        header = headers[start]
        stop = positions[index + 1] if index + 1 < len(positions) else len(text)
        boundary_issues = []
        if layout.get("answerSequence") == "ascending-consecutive" and index + 1 < len(
            positions
        ):
            number, following = (
                int(header.group(1)),
                int(headers[positions[index + 1]].group(1)),
            )
            if following != number + 1:
                boundary_issues.append(
                    f"Answer header {number} is followed by {following}; inspect missing or misread boundaries before assigning this region."
                )
        observations = []
        if start in valid:
            observations.append(
                (valid[start].group(2), "header", start, valid[start].end())
            )
        for conclusion in conclusions:
            observations.extend(
                (m.group(1), "conclusion", m.start(), m.end())
                for m in conclusion.finditer(text, header.start(), stop)
            )
        labels_allowed = layout.get("answerLabels", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        observations = [
            o
            for o in observations
            if o[0]
            and all(c in labels_allowed for c in o[0])
            and len(set(o[0])) == len(o[0])
        ]
        result.append(
            {
                "number": str(int(header.group(1))),
                "boundaryIssues": boundary_issues,
                "start": start,
                "end": stop,
                "explanation": text[header.end() : stop].strip(),
                "observations": [
                    {
                        "correctAnswers": list(labels),
                        "method": method,
                        "start": left,
                        "end": right,
                    }
                    for labels, method, left, right in observations
                ],
            }
        )
    return result


def selection_signals(text, profile):
    """Comparable structural signals; more text is not proof of better OCR."""
    questions = set(re.findall(profile["questionPattern"], text, re.M))
    # Keep number identities, not wording that may differ between passes.
    numbers = {m[0] if isinstance(m, tuple) else m for m in questions}
    answers = {
        (r["number"], tuple(o["correctAnswers"]))
        for r in collect(text, profile)
        for o in r["observations"]
    }
    return numbers, answers


def select_refinement(previous, candidate, profile):
    if not candidate.strip():
        return previous, "empty_candidate"
    old_numbers, old_answers = selection_signals(previous, profile)
    numbers, answers = selection_signals(candidate, profile)
    if not old_numbers <= numbers or not old_answers <= answers:
        return previous, "lost_or_changed_evidence"
    if len(candidate.strip()) < len(previous.strip()) * 0.7:
        return previous, "text_loss_requires_review"
    return candidate, "candidate_preserves_signals"
