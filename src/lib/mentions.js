// @mdxeditor/typeahead-plugin persists a selected mention as a markdown text
// directive: `:mention[<userId>]` (see MarkdownEditor.jsx's convertToId).
// Storing the id rather than the display name is what lets a rename show up
// correctly later (spec §6.2) — the display name is always re-resolved at
// render time from a live user lookup, never trusted from the stored text.
const MENTION_RE = /:mention\[([^\]]+)\]/g

export function extractMentionUserIds(markdown) {
  const ids = new Set()
  for (const match of markdown.matchAll(MENTION_RE)) ids.add(match[1])
  return [...ids]
}

// react-markdown/remark-gfm don't know the `:mention[...]` directive syntax
// (GFM has no concept of directives), so before handing text to ReactMarkdown
// we rewrite each marker into a plain CommonMark link — `[id](mention:id)` —
// that remark-gfm already parses natively. MarkdownContent then recognizes
// the `mention:` scheme in its `a` component override and renders a chip
// instead of a real link.
export function expandMentionDirectives(markdown) {
  return markdown.replace(MENTION_RE, (_match, userId) => `[${userId}](mention:${userId})`)
}
