# User workflows

Discover current tool schemas first. Names here are checked against repository
registrations, but an older deployment may expose fewer tools. Respect each
response's pagination, caps and truncation indicators; never call a partial result
complete. Resolve exam names to IDs rather than guessing them.

## Study and history

- **Review today:** get learning overview, resolve the relevant exam if supplied,
  then request recommended questions or a review set. Recommendations blend wrong
  questions, bookmarks and unattempted questions with deduplication; review sets
  are samples, not a due-date scheduler. Present a study plan without recording
  attempts or altering wrong-book status.
- **Repeatedly wrong AWS questions:** resolve the AWS exam; query wrong questions
  and inspect returned wrong counts/history. Do not call a single wrong answer
  "repeated". Follow pages and disclose missing count detail rather than inventing
  a history. Do not mark anything mastered unless that mutation is separately
  requested and actually exposed.
- **Recent progress:** combine the requested exam's progress/statistics and recent
  attempts. State the returned date range and denominator, distinguish all-time
  accuracy from recent scores, and retain truncation caveats.
- **Unattempted IAM questions:** discover the exam, use a supported candidate
  filter or intersect paged unattempted results with question search. Candidate
  tools are bounded samples; label them accordingly. Discovery can include
  answer keys, while practice/review candidate tools omit them. Avoid revealing
  answers if the user requested a quiz.
- **Annotations:** read the current user's annotation tools and supported filters.
  No annotation-writing tool is implied merely because annotations can be listed.

## Knowledge Points

- **Search Route 53:** use `user_search_knowledge_points`, then fetch only relevant
  full notes. Knowledge Point groups/tags are personal and separate from the
  administrator's question-bank taxonomy.
- **Create and link:** resolve question IDs first, then use the exposed create
  schema with the requested title/body/group/tags/question links. Creation can
  apply supported fields atomically. Do not create an exam or change a question.
- **Edit:** fetch the latest note; preserve unrelated text and pass its
  `baseRevision` to `user_update_knowledge_point`. On conflict, re-fetch and show
  how the requested change combines with intervening edits. Resolve competing
  edits with the user instead of blind revision replacement.
- **Groups/tags/links:** use only owner-scoped tools from discovery. Unlinking a
  tag from one note differs from deleting the personal tag from every note.
  Deleting a group leaves its notes ungrouped; do not imply the notes are deleted.
  Explain these scopes when resolving destructive intent.
- **Order:** list exactly one unfiltered group or Ungrouped scope to obtain
  `orderRevision`, then pass it as `expectedOrderRevision` with a same-scope
  `beforeId` (or null for the end). Re-list that scope after conflicts; never use
  a filtered list's order to reorder the whole scope.
- **Attachments:** preserve stable image references returned with a note. Only
  attach/upload/delete if discovery exposes the corresponding owner-scoped
  capability; otherwise explain that the user must use the web editor. Never
  fabricate an upload tool or call storage directly.

After a timeout on creation/link/edit, inspect current state before deciding
whether another write is needed. Do not create duplicate notes to test access.
