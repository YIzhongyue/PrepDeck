# PrepDeck import format 1.0

Use this self-contained contract when producing the final JSON. Unknown extra fields are tolerated by PrepDeck, but omit them unless the user needs them.

## Top-level object

| Field | Requirement |
| --- | --- |
| `schemaVersion` | Required; exactly `"1.0"`. |
| `exam` | Required object with non-empty `id` and `name`. Optional string fields: `subject`, `language`. Use a stable lowercase hyphenated `id`; use a BCP-47 language tag. |
| `source` | Optional provenance object. Supported string fields: `originalFileName`, `extractedBy`, `extractedAt`. The timestamp must be RFC 3339 date-time. |
| `questions` | Required non-empty array in source order. Array position becomes the exam sequence. |

## Question object

Required fields:

- `type`: `single_choice`, `multiple_choice`, `true_false`, or `fill_blank`.
- `stem`: non-empty string; Markdown is allowed.
- `correctAnswers`: non-empty array of strings.

Optional fields:

- `externalId`: non-empty stable source question identifier used for re-import de-duplication. Required by the PDF evidence pipeline, optional for general imports. Duplicate IDs within one file are errors; existing database IDs still use the importer’s skip/overwrite strategy.
- `options`: required and non-empty for all choice types; omit for `fill_blank`.
- `explanation`: official source explanation as a string, or `null`.
- `difficulty`: `easy`, `medium`, `hard`, or `null`.
- `tags`: array of strings.
- `points`: finite number; default is 1 when omitted.

Each option is `{ "id": "A", "text": "..." }`. IDs must be unique within the question. Every choice-based `correctAnswers` value must exactly equal an option ID. A `single_choice` has exactly one answer. A `multiple_choice` has at least two distinct answers. A `true_false` has exactly the two options with IDs `true` and `false`, and exactly one matching answer. A `fill_blank` has one or more source-backed accepted answer strings and no `options` field.

## Example

```json
{
  "schemaVersion": "1.0",
  "exam": {
    "id": "network-fundamentals",
    "name": "Network Fundamentals",
    "subject": "Networking",
    "language": "en"
  },
  "source": {
    "originalFileName": "network-fundamentals.pdf",
    "extractedBy": "pdf-to-quiz skill",
    "extractedAt": "2026-09-06T12:00:00Z"
  },
  "questions": [
    {
      "externalId": "Q1",
      "type": "single_choice",
      "stem": "Which protocol resolves an IPv4 address to a MAC address?",
      "options": [
        { "id": "A", "text": "ARP" },
        { "id": "B", "text": "DNS" },
        { "id": "C", "text": "DHCP" }
      ],
      "correctAnswers": ["A"],
      "explanation": "ARP performs IPv4-to-MAC address resolution.",
      "points": 1
    }
  ]
}
```

The final file must contain only the JSON object. Keep extraction uncertainties in the separate review artifact described in `SKILL.md`.

The Python and shared TypeScript validators enforce the same import rules. Optional fields must be omitted rather than set to `null`, except `explanation` and `difficulty`. Timestamps require a real date, time and timezone (seconds 00–59). Source references belong in the separate [evidence workspace](evidence-format.md), not the import file. The schema accepts an optional boolean `needsReview` that flags an imported question as still awaiting a human check in the application; this pipeline never emits it, because a question it cannot resolve from the source stays in the review artifact instead of being exported flagged.

## Import size limits

A file may contain at most 1,000 questions and must fit the Worker's 5 MiB UTF-8 body limit and 32-level JSON nesting limit. Each question allows at most 20 options and 50 tags. Maximum text lengths are 20,000 for stems, 10,000 per option, 50,000 for explanations and 200 per tag. Runtime validators measure text in UTF-16 code units to match JavaScript (characters outside the BMP count as two); JSON Schema's `maxLength` is only a structural upper bound. The standalone validator checks the actual file bytes/depth, and the builder checks the serialized export before writing it.

If the source exceeds a file limit, export manageable subsets using copies of the master inventory: mark questions reserved for other files `excluded` with that reason and keep their evidence. Retain original IDs and source order in each subset. Never truncate question text to fit a limit.
