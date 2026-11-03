import { z } from "zod";

// Limits apply before trimming, including repeated/empty REST filter entries.
// Search retains SQL LIKE semantics: % and _ are intentional wildcards.
export const knowledgePointSearchTextSchema = z.string().max(200);
export const knowledgePointSearchTagsSchema = z.array(z.string().max(200)).max(20);
