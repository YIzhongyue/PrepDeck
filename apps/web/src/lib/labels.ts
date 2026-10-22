// Display names for fixed values the API sends as identifiers, such as a
// question's difficulty. The identifiers stay as they are on the wire; only
// what is shown follows the interface language (issue #191).

import { t } from "../i18n/runtime";

const DIFFICULTIES = ["easy", "medium", "hard", "unspecified"] as const;
type DifficultyId = (typeof DIFFICULTIES)[number];

/** "Easy", "Medium", "Hard", or the value itself for one this build does not know. */
export function difficultyLabel(difficulty: string | null | undefined): string {
  if (!difficulty) return t("common.difficulty.unspecified");
  return (DIFFICULTIES as readonly string[]).includes(difficulty) ? t(`common.difficulty.${difficulty as DifficultyId}`) : difficulty;
}
