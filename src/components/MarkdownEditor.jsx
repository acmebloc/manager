import { useEffect, useMemo, useState } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor'
import { typeaheadPlugin } from '@mdxeditor/typeahead-plugin'
import { matchesKoreanQuery } from '../lib/korean'
import { Avatar } from './ProjectMembers'

// This app has no manual dark-mode toggle — it follows the OS preference via
// prefers-color-scheme (Tailwind v4 default, no `dark` class strategy
// configured in src/index.css). MDXEditor's own dark mode is a CSS class
// (`dark-theme`) rather than a media query, so it has to be driven explicitly.
function usePrefersDark() {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => setDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return dark
}

// Serializes to `:mention[<userId>]` (convertToId) — see src/lib/mentions.js
// for why the id, not the display name, is what gets stored.
function mentionConfig(mentionMembers, mentionUsersById) {
  return {
    type: 'mention',
    trigger: '@',
    maxResults: 6,
    convertToId: (member) => member.id,
    searchCallback: async (query) =>
      mentionMembers.filter((m) => matchesKoreanQuery(m.name, query) || matchesKoreanQuery(m.email, query)),
    renderMenuItem: (member) => (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Avatar user={member} />
        <span className="truncate text-sm text-gray-900 dark:text-white">{member.name}</span>
      </div>
    ),
    // Resolved from the live member/mention map, never from text frozen in
    // the marker — so a rename is reflected immediately (spec §6.2).
    Editor: ({ node }) => {
      const userId = node.getContent()
      const user = mentionUsersById?.get(userId)
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-sm font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
          @{user?.name || '알 수 없음'}
        </span>
      )
    },
    menuClassName:
      'rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800',
    menuItemClassName: 'cursor-pointer',
    menuItemSelectedClassName: 'bg-indigo-50 dark:bg-indigo-950/40',
  }
}

// Shared editing surface for task descriptions and comments. `mentionMembers`
// is omitted for task descriptions (mentions are a comment-only feature,
// spec §6) and provided for comments to enable the @ typeahead.
function MarkdownEditor({ value, onChange, mentionMembers, mentionUsersById, placeholder }) {
  const dark = usePrefersDark()

  const plugins = useMemo(() => {
    const base = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarContents: () => (
          <>
            <UndoRedo />
            <BoldItalicUnderlineToggles />
            <ListsToggle />
            <BlockTypeSelect />
            <CreateLink />
          </>
        ),
      }),
    ]
    if (mentionMembers) {
      base.push(typeaheadPlugin({ configs: [mentionConfig(mentionMembers, mentionUsersById)] }))
    }
    return base
    // mentionUsersById is intentionally left out — it changes far more often
    // than mentionMembers (recomputed whenever any comment loads), and
    // rebuilding the plugin list would fight the editor's own lifecycle.
    // Each mount (edit toggle re-mounts this component fresh, see
    // TaskComments.jsx) picks up whatever value is current at that point.
  }, [mentionMembers])

  return (
    <div className="rounded-md border border-gray-300 dark:border-gray-600">
      <MDXEditor
        markdown={value}
        onChange={onChange}
        plugins={plugins}
        placeholder={placeholder}
        className={dark ? 'dark-theme' : ''}
        contentEditableClassName="min-h-24 px-3 py-2 text-sm text-gray-900 focus:outline-none dark:text-white"
      />
    </div>
  )
}

export default MarkdownEditor
