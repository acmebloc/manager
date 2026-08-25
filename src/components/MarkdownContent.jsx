import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { expandMentionDirectives } from '../lib/mentions'
import { Avatar } from './ProjectMembers'

const MENTION_SCHEME = 'mention:'

// react-markdown sanitizes URLs by default and only allows a fixed protocol
// allowlist (http/https/mailto/...) — our custom `mention:` scheme isn't on
// it, so it gets silently blanked out unless let through here. `data:` (how
// MarkdownEditor embeds uploaded images) is let through too, but only for
// `<img src>` — never for `<a href>`, where a `data:text/html,<script>...`
// link would render as a clickable, viewer-executable payload.
function allowMentionAndDataUrls(url, key, node) {
  if (url.startsWith(MENTION_SCHEME)) return url
  if (url.startsWith('data:') && node?.tagName === 'img') return url
  return defaultUrlTransform(url)
}

// Read-only renderer, deliberately separate from MarkdownEditor — MDXEditor's
// own readOnly mode is explicitly documented as not meant for display
// ("render the markdown using a library of your choice instead").
function MarkdownLink({ href, children, mentionUsersById }) {
  if (href?.startsWith(MENTION_SCHEME)) {
    const userId = href.slice(MENTION_SCHEME.length)
    const user = mentionUsersById?.get(userId)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-sm font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
        {user && <Avatar user={user} />}@{user?.name || '알 수 없음'}
      </span>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-indigo-600 underline dark:text-indigo-400">
      {children}
    </a>
  )
}

function MarkdownContent({ text, mentionUsersById }) {
  if (!text) return null

  return (
    <div className="text-sm text-gray-800 dark:text-gray-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={allowMentionAndDataUrls}
        components={{
          a: (props) => <MarkdownLink {...props} mentionUsersById={mentionUsersById} />,
          img: ({ src, alt }) => <img src={src} alt={alt} className="mb-2 max-w-full rounded-md last:mb-0" />,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-gray-300 pl-3 text-gray-600 last:mb-0 dark:border-gray-600 dark:text-gray-400">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h1 className="mb-2 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-base font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold">{children}</h3>,
          code: ({ children }) => (
            <code className="font-mono text-[13px] text-gray-800 dark:text-gray-200">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-md bg-gray-100 p-2 text-xs last:mb-0 dark:bg-gray-800">
              {children}
            </pre>
          ),
        }}
      >
        {expandMentionDirectives(text)}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownContent
