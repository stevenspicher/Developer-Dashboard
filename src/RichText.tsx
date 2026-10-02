// Renders description text from the bridges: ADO HTML converted by
// htmlToText (line breaks, bullets, [label](url) links) or plain Notion text.
// Links open in a new tab; everything else is rendered as text, never HTML.

const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|((?:https?:\/\/|mailto:)[^\s<>"]+)/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/
const MAX_URL_LABEL = 48

// A bare URL is shown as host + path, shortened so it doesn't swamp the text.
function urlLabel(url: string) {
  try {
    const u = new URL(url)
    const label = u.protocol === 'mailto:' ? u.pathname : u.host + (u.pathname === '/' ? '' : u.pathname)
    return label.length > MAX_URL_LABEL ? `${label.slice(0, MAX_URL_LABEL - 1)}…` : label
  } catch {
    return url
  }
}

// Inline text with its links made clickable; use inside a span or line.
export function LinkedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(LINK)) {
    const [whole, label, href, bare] = m
    const start = m.index
    let end = start + whole.length
    let url = href
    let shown = label
    if (bare) {
      url = bare.replace(TRAILING_PUNCTUATION, '')
      end = start + url.length
      shown = urlLabel(url)
    }
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <a key={start} href={url} target="_blank" rel="noreferrer" title={url} onClick={e => e.stopPropagation()} className="link break-all">
        {shown}
      </a>,
    )
    last = end
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// A block of text that keeps its line breaks and indentation.
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`whitespace-pre-wrap break-words ${className}`}>
      <LinkedText text={text} />
    </div>
  )
}
