import './foliate-js/view.js'
import { FootnoteHandler } from './foliate-js/footnotes.js'

const view = document.getElementById('view')
const errorEl = document.getElementById('error')
const searchBar = document.getElementById('search-bar')
const searchInput = document.getElementById('search-input')
const searchCount = document.getElementById('search-count')
const searchPrevBtn = document.getElementById('search-prev')
const searchNextBtn = document.getElementById('search-next')
const searchCloseBtn = document.getElementById('search-close')

// ─── Themes ──────────────────────────────────────────────────────────────────

const themes = {
  light: { '--bg': '#ffffff', '--fg': '#000000' },
  sepia: { '--bg': '#f5ead0', '--fg': '#3b2a1a' },
  dark:  { '--bg': '#1a1a1a', '--fg': '#e0e0e0' },
}

function applyTheme(name) {
  const vars = themes[name] || themes.light
  const root = document.documentElement
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  const style = document.getElementById('theme-style') || document.createElement('style')
  style.id = 'theme-style'
  style.textContent = name === 'dark'
    ? `foliate-view::part(filter) { filter: invert(1) hue-rotate(180deg); }`
    : ''
  document.head.appendChild(style)
}

let bookFontSize = 16

function applyFontSize(size) {
  bookFontSize = size
  view.renderer?.setStyles?.(`html { font-size: ${size}px !important; }`)
}

// ─── Footnote popup ──────────────────────────────────────────────────────────

const footnotePopup = document.getElementById('footnote-popup')
const footnoteContent = document.getElementById('footnote-popup-content')
const footnoteClose = document.getElementById('footnote-popup-close')

const footnoteHandler = new FootnoteHandler()
// Disable heuristic detection: only handle explicitly epub:type-tagged footnotes/endnotes.
// The heuristic fires on any superscript-styled link (vertical-align: top/super), which
// falsely intercepts TOC chapter links in EPUBs that style their list entries that way.
footnoteHandler.detectFootnotes = false

function closeFootnote() {
  footnotePopup.classList.remove('open')
  footnoteContent.replaceChildren()
}

footnoteClose.addEventListener('click', closeFootnote)

footnoteHandler.addEventListener('render', e => {
  const { view: footnoteView } = e.detail
  footnoteContent.replaceChildren(footnoteView)
  footnotePopup.classList.add('open')
})

view.addEventListener('link', e => footnoteHandler.handle(view.book, e))

// ─── Messaging ───────────────────────────────────────────────────────────────

function notify(msg) {
  window.parent.postMessage(msg, '*')
}

// ─── Search ──────────────────────────────────────────────────────────────────

let searchResults = []
let searchCursor = -1
let searchGeneration = 0

function openSearch() {
  searchBar.classList.add('open')
  searchInput.focus()
  searchInput.select()
}

function closeSearch() {
  searchBar.classList.remove('open')
  searchInput.value = ''
  searchCount.textContent = ''
  searchResults = []
  searchCursor = -1
  view.clearSearch()
}

function updateCount() {
  if (!searchResults.length) {
    searchCount.textContent = searchInput.value ? 'No results' : ''
  } else {
    searchCount.textContent = `${searchCursor + 1} / ${searchResults.length}`
  }
}

async function runSearch(query) {
  view.clearSearch()
  searchResults = []
  searchCursor = -1
  searchCount.textContent = '…'

  if (!query.trim()) { searchCount.textContent = ''; return }

  const gen = searchGeneration
  for await (const result of view.search({ query })) {
    if (searchGeneration !== gen) return   // new search started, abort
    if (result === 'done') break

    // whole-book search: results are grouped by section in result.subitems
    // single-section search: result.cfi is set directly
    const items = result.subitems ?? (result.cfi ? [result] : [])
    for (const item of items) {
      if (!item.cfi) continue
      searchResults.push(item.cfi)
      if (searchCursor === -1) {
        searchCursor = 0
        await view.goTo(item.cfi)
      }
    }
    updateCount()
  }
  updateCount()
}

async function searchNext() {
  if (!searchResults.length) return
  searchCursor = (searchCursor + 1) % searchResults.length
  await view.goTo(searchResults[searchCursor])
  updateCount()
}

async function searchPrev() {
  if (!searchResults.length) return
  searchCursor = (searchCursor - 1 + searchResults.length) % searchResults.length
  await view.goTo(searchResults[searchCursor])
  updateCount()
}

// Debounce search input
let searchTimer = null
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchGeneration++
  searchTimer = setTimeout(() => runSearch(searchInput.value), 300)
})

searchPrevBtn.addEventListener('click', searchPrev)
searchNextBtn.addEventListener('click', searchNext)
searchCloseBtn.addEventListener('click', closeSearch)

// ─── View events ─────────────────────────────────────────────────────────────

view.addEventListener('relocate', e => {
  const { cfi, fraction } = e.detail
  notify({ type: 'relocate', cfi, fraction })
})

view.addEventListener('load', () => {
  view.renderer?.setStyles?.(`html { font-size: ${bookFontSize}px !important; }`)

  // Foliate renders each section in its own sub-iframe. Key events fired there
  // don't reach reader.html's window, so we forward them from each loaded frame.
  const contents = view.renderer?.getContents?.() ?? []
  for (const { doc } of contents) {
    doc?.defaultView?.addEventListener('keydown', handleKey)
  }

  notify({ type: 'ready' })
})

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

function handleKey(e) {
  const inSearch = document.activeElement === searchInput

  if (inSearch) {
    if (e.key === 'Enter')       { e.preventDefault(); e.shiftKey ? searchPrev() : searchNext() }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
    return
  }

  // Navigation
  if (e.key === 'ArrowRight' || e.key === 'l' || (e.key === ' ' && !e.shiftKey)) {
    e.preventDefault(); view.next()
  }
  else if (e.key === 'ArrowLeft' || e.key === 'h' || (e.key === ' ' && e.shiftKey)) {
    e.preventDefault(); view.prev()
  }
  // Search
  else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault(); openSearch()
  }
  else if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault(); openSearch()
  }
  // Escape: dismiss footnote → close search → tell parent to exit
  else if (e.key === 'Escape') {
    if (footnotePopup.classList.contains('open')) closeFootnote()
    else if (searchBar.classList.contains('open')) closeSearch()
    else notify({ type: 'escape' })
  }
  // Font size
  else if (e.key === '+' || e.key === '=') notify({ type: 'keyAction', action: 'fontSizeUp' })
  else if (e.key === '-' || e.key === '_') notify({ type: 'keyAction', action: 'fontSizeDown' })
  // Themes
  else if (e.key === '1') notify({ type: 'keyAction', action: 'themeLight' })
  else if (e.key === '2') notify({ type: 'keyAction', action: 'themeSepia' })
  else if (e.key === '3') notify({ type: 'keyAction', action: 'themeDark' })
  // Help
  else if (e.key === '?') notify({ type: 'keyAction', action: 'showHelp' })
}

// Outer window (toolbar focus)
window.addEventListener('keydown', handleKey)

// ─── Commands from parent ─────────────────────────────────────────────────────

window.addEventListener('message', async e => {
  const { type, ...data } = e.data || {}
  if (!type) return

  if (type === 'open') {
    try {
      errorEl.style.display = 'none'
      const token = localStorage.getItem('token')
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(data.url, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const extMap = {
        'application/epub+zip': '.epub',
        'application/x-mobipocket-ebook': '.mobi',
        'application/vnd.amazon.ebook': '.azw3',
        'application/x-cbz': '.cbz',
        'application/pdf': '.pdf',
      }
      const ct = (res.headers.get('Content-Type') || '').split(';')[0].trim()
      const ext = extMap[ct] || '.epub'
      const file = new File([blob], `book${ext}`, { type: blob.type })
      await view.open(file)
      if (data.cfi) await view.goTo(data.cfi)
    } catch (err) {
      errorEl.style.display = 'block'
      errorEl.textContent = `Failed to open book: ${err.message}`
      notify({ type: 'error', message: err.message })
    }
  }
  else if (type === 'next')        view.next()
  else if (type === 'prev')        view.prev()
  else if (type === 'goto')        { if (data.cfi) await view.goTo(data.cfi) }
  else if (type === 'setTheme')    applyTheme(data.theme)
  else if (type === 'setFontSize') applyFontSize(data.size)
  else if (type === 'openSearch')  openSearch()
  else if (type === 'closeSearch') closeSearch()
})

// Signal ready to receive commands
notify({ type: 'iframeReady' })
