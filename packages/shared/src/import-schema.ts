// Question Import JSON Schema — docs/requirements/data-model-and-import-format.md#import-contract.
// This is the schema the companion Claude Skill (skills/pdf-to-quiz) must produce,
// and that the Worker's import endpoint (FR-2.2) must validate against.
// Unique external/option IDs and answer-to-option references additionally require
// the semantic checks in import-validate.ts (not expressible in draft-07).

export const QUESTION_IMPORT_SCHEMA_VERSION = "1.0" as const;

export const questionImportJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "PrepDeck Question Import File",
  type: "object",
  required: ["schemaVersion", "exam", "questions"],
  properties: {
    schemaVersion: {
      type: "string",
      description: "Semantic version of this schema, e.g. '1.0'.",
      const: "1.0"
    },
    exam: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string", pattern: "[^\\s\\u0085\\u001c-\\u001f\\ufeff]", description: "Stable slug, e.g. 'aws-sap-c02'." },
        name: { type: "string", pattern: "[^\\s\\u0085\\u001c-\\u001f\\ufeff]", description: "Human-readable exam name." },
        subject: { type: "string", description: "Free-text subject/category grouping." },
        language: { type: "string", description: "BCP-47 language tag of the question content, e.g. 'en'." }
      }
    },
    source: {
      type: "object",
      description: "Provenance metadata, informational only.",
      properties: {
        originalFileName: { type: "string" },
        extractedBy: { type: "string" },
        extractedAt: { type: "string", format: "date-time" }
      }
    },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 1000,
      items: { $ref: "#/definitions/question" }
    }
  },
  definitions: {
    question: {
      type: "object",
      required: ["type", "stem", "correctAnswers"],
      properties: {
        externalId: {
          type: "string",
          pattern: "[^\\s\\u0085\\u001c-\\u001f\\ufeff]",
          description: "Original question number/id from the source document, used for de-duplication on re-import."
        },
        type: {
          type: "string",
          description: "Extensible: new values may be added in future schema versions.",
          enum: ["single_choice", "multiple_choice", "true_false", "fill_blank"]
        },
        stem: {
          type: "string",
          maxLength: 20000,
          pattern: "[^\\s\\u0085\\u001c-\\u001f\\ufeff]",
          description: "The question text. Markdown formatting is permitted."
        },
        options: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          description: "Required for single_choice/multiple_choice/true_false; omitted for fill_blank.",
          items: {
            type: "object",
            required: ["id", "text"],
            properties: {
              id: { type: "string", pattern: "[^\\s\\u0085\\u001c-\\u001f\\ufeff]", description: "Short stable option id, e.g. 'A'." },
              text: { type: "string", maxLength: 10000, pattern: "[^\\s\\u0085\\u001c-\\u001f\\ufeff]" }
            }
          }
        },
        correctAnswers: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", pattern: "[^\\s\\u0085\\u001c-\\u001f\\ufeff]" },
          description:
            'For choice-based types: array of correct option ids. For true_false: ["true"] or ["false"]. For fill_blank: one or more accepted answer strings.'
        },
        explanation: {
          type: ["string", "null"],
          maxLength: 50000,
          description: "Official explanation extracted from the source material, if present."
        },
        difficulty: {
          type: ["string", "null"],
          enum: ["easy", "medium", "hard", null]
        },
        tags: {
          type: "array",
          maxItems: 50,
          items: { type: "string", maxLength: 200 }
        },
        points: {
          type: "number",
          default: 1
        }
      },
      allOf: [
        {
          if: { properties: { type: { const: "fill_blank" } } },
          then: { not: { required: ["options"] } },
          else: { required: ["options"] }
        },
        {
          if: { properties: { type: { enum: ["single_choice", "true_false"] } } },
          then: { properties: { correctAnswers: { maxItems: 1 } } }
        },
        {
          if: { properties: { type: { const: "multiple_choice" } } },
          then: { properties: { correctAnswers: { minItems: 2 } } }
        },
        {
          if: { properties: { type: { const: "true_false" } } },
          then: {
            properties: {
              options: {
                minItems: 2, maxItems: 2,
                items: { properties: { id: { enum: ["true", "false"] } } },
                allOf: [
                  { contains: { properties: { id: { const: "true" } } } },
                  { contains: { properties: { id: { const: "false" } } } }
                ]
              },
              correctAnswers: { items: { enum: ["true", "false"] } }
            }
          }
        }
      ]
    }
  }
} as const;

export interface QuestionImportFile {
  schemaVersion: typeof QUESTION_IMPORT_SCHEMA_VERSION;
  exam: {
    id: string;
    name: string;
    subject?: string;
    language?: string;
  };
  source?: {
    originalFileName?: string;
    extractedBy?: string;
    extractedAt?: string;
  };
  questions: QuestionImportRow[];
}

export interface QuestionImportRow {
  externalId?: string;
  type: "single_choice" | "multiple_choice" | "true_false" | "fill_blank";
  stem: string;
  options?: { id: string; text: string }[];
  correctAnswers: string[];
  explanation?: string | null;
  difficulty?: "easy" | "medium" | "hard" | null;
  tags?: string[];
  points?: number;
}
