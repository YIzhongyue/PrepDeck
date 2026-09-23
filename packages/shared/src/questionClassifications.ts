export interface QuestionClassification {
  id: string;
  label: string;
  allLabel: string;
  values: { id: string; label: string; tags: string[] }[];
}
export interface QuestionClassificationProfile {
  examIds?: string[];
  examSlugs?: string[];
  examTags?: string[];
  dimensions: QuestionClassification[];
}
export interface QuestionClassificationCatalog {
  dimensions: (Omit<QuestionClassification, "values"> & {
    values: { id: string; label: string; count: number }[];
    unclassifiedCount: number;
  })[];
}
export const UNCLASSIFIED_QUESTION_VALUE = "__unclassified";
