/**
 * Returns the subset of `allTags` whose names:
 *  - are NOT already present on the note (`noteTags`)
 *  - case-insensitively contain the current input `query`
 *
 * If `query` is empty/blank every remaining tag is returned.
 */
export function filterTagOptions(
  allTags: { name: string }[],
  noteTags: string[],
  query: string,
): string[] {
  const noteSet = new Set(noteTags.map((t) => t.toLowerCase()));
  const q = query.trim().toLowerCase();
  return allTags
    .map((t) => t.name)
    .filter(
      (name) =>
        !noteSet.has(name.toLowerCase()) &&
        (q === '' || name.toLowerCase().includes(q)),
    );
}
