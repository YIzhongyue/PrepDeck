"""Cross-check existing candidate keys against an independently reviewed source.

The reference is a local transcription of an answer table/other official key,
bound to the same evidence document. It never supplies missing candidate keys or
approves a question; disagreement clears scoring and remains visible to review.
"""

import copy


def crosscheck(document, package, reviews, entries, reference):
    if reference.get("documentId") != document["documentId"]:
        raise ValueError("answer reference document identity mismatch")
    review = reference.get("review", {})
    if review.get("status") != "reviewed" or not str(review.get("reason", "")).strip():
        raise ValueError(
            "independent answer reference needs source review and a reason"
        )
    rows = reference.get("entries")
    if not isinstance(rows, list) or not rows:
        raise ValueError("answer reference needs entries")
    blocks = {b["id"] for p in document["pages"] for b in p["blocks"]}
    identities = set()
    for row in rows:
        identity, labels, refs = (
            row.get("sourceQuestionId"),
            row.get("correctAnswers"),
            row.get("blockRefs"),
        )
        if not isinstance(identity, str) or not identity or identity in identities:
            raise ValueError("answer reference needs unique source question IDs")
        identities.add(identity)
        if (
            not isinstance(labels, list)
            or not labels
            or any(not isinstance(v, str) or not v for v in labels)
            or len(set(labels)) != len(labels)
        ):
            raise ValueError("answer reference needs explicit unique answer labels")
        if (
            not isinstance(refs, list)
            or not refs
            or any(not isinstance(ref, str) or ref not in blocks for ref in refs)
        ):
            raise ValueError("answer reference needs retained source blocks")
    references = {row["sourceQuestionId"]: row for row in rows}
    result = {"compared": 0, "conflicts": [], "uncomparedSourceQuestions": []}
    compared = set()
    for item in package["questions"]:
        status = next(r for r in reviews if r["externalId"] == item["externalId"])
        source_id = status["sourceQuestionId"]
        if source_id not in references or not item["scoring"]["correctAnswers"]:
            continue
        row = references[source_id]
        compared.add(source_id)
        result["compared"] += 1
        identity = f"reference-{len(entries) + 1}"
        while any(e["id"] == identity for e in entries):
            identity += "-key"
        entries.append(
            {
                **copy.deepcopy(row),
                "id": identity,
                "questionId": item["externalId"],
                "reviewPages": sorted(
                    {
                        p["page"]
                        for p in document["pages"]
                        if any(b["id"] in row["blockRefs"] for b in p["blocks"])
                    }
                ),
                "referenceReview": dict(review),
            }
        )
        status["answerEntries"].append(identity)
        status["answerEvidence"] = sorted(
            set(status["answerEvidence"] + row["blockRefs"])
        )
        if set(item["scoring"]["correctAnswers"]) != set(row["correctAnswers"]):
            item["scoring"]["correctAnswers"] = []
            status["status"] = "review"
            status["reason"] = (
                "Independent source key disagrees; reconcile the original question, explanation and answer table."
            )
            result["conflicts"].append(item["externalId"])
    result["uncomparedSourceQuestions"] = sorted(identities - compared)
    return result
