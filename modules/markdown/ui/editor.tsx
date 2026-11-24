'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, Annotation, type Range } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { GFM } from '@lezer/markdown'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

type MarkdownEditorProps = {
  id: string
  labelId: string
  value: string
  onChange: (value: string) => void
}

export type MarkdownImageInsertion = {
  insert: (markdown: string) => boolean
  release: () => void
}

export type MarkdownEditorHandle = {
  prepareImageInsertion: () => MarkdownImageInsertion | null
}

const externalDocumentChange = Annotation.define<boolean>()

class MarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
    readonly ariaLabel?: string,
  ) {
    super()
  }

  eq(other: MarkerWidget) {
    return other.text === this.text && other.className === this.className && other.ariaLabel === this.ariaLabel
  }

  ignoreEvent() {
    return false
  }

  toDOM() {
    const marker = document.createElement('span')
    marker.className = this.className
    marker.textContent = this.text
    if (this.ariaLabel) marker.setAttribute('aria-label', this.ariaLabel)
    else marker.setAttribute('aria-hidden', 'true')
    return marker
  }
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super()
  }

  eq(other: ImagePreviewWidget) {
    return other.src === this.src && other.alt === this.alt
  }

  ignoreEvent() {
    return false
  }

  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-md-image-preview'
    const image = document.createElement('img')
    image.src = this.src
    image.alt = this.alt
    image.loading = 'lazy'
    image.className = 'cm-md-image-img'
    image.addEventListener('error', () => {
      wrapper.replaceChildren(document.createTextNode(this.alt || this.src))
      wrapper.classList.add('cm-md-image-fallback')
    })
    wrapper.appendChild(image)
    if (this.alt) {
      const caption = document.createElement('span')
      caption.className = 'cm-md-image-caption'
      caption.textContent = this.alt
      wrapper.appendChild(caption)
    }
    return wrapper
  }
}

function previewImageUrl(raw: string): string | null {
  const trimmed = raw.trim()
  const unwrapped = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed
  if (!unwrapped) return null
  if (/^\/media\/[^\s]+$/u.test(unwrapped)) return unwrapped
  try {
    const parsed = new URL(unwrapped)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href
  } catch {
    return null
  }
  return null
}

function selectionTouches(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some(range => range.empty
    ? range.head >= from && range.head <= to
    : range.from < to && range.to > from)
}

function selectionTouchesLine(view: EditorView, lineNumber: number) {
  return view.state.selection.ranges.some(range =>
    view.state.doc.lineAt(range.head).number === lineNumber)
}

function addLineRange(
  view: EditorView,
  lines: Map<number, Set<string>>,
  from: number,
  to: number,
  className: string,
) {
  const start = Math.max(from, view.viewport.from)
  const end = Math.min(to, view.viewport.to, view.state.doc.length)
  if (start > end) return

  const first = view.state.doc.lineAt(start).number
  const last = view.state.doc.lineAt(end).number
  for (let number = first; number <= last; number += 1) {
    const lineStart = view.state.doc.line(number).from
    const classes = lines.get(lineStart) ?? new Set<string>()
    classes.add(className)
    lines.set(lineStart, classes)
  }
}

function directChildren(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child)
  return result
}

function descendants(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = []
  const visit = (parent: SyntaxNode) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      result.push(child)
      visit(child)
    }
  }
  visit(node)
  return result
}

function buildLivePreview(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const lines = new Map<number, Set<string>>()
  const hide = (from: number, to: number) => {
    if (from < to) decorations.push(Decoration.replace({}).range(from, to))
  }
  const mark = (from: number, to: number, className: string) => {
    if (from < to) decorations.push(Decoration.mark({ class: className }).range(from, to))
  }
  const widget = (from: number, to: number, text: string, className: string, ariaLabel?: string) => {
    if (from < to) decorations.push(Decoration.replace({
      widget: new MarkerWidget(text, className, ariaLabel),
    }).range(from, to))
  }

  const selectionEnd = view.state.selection.ranges.reduce((end, range) => Math.max(end, range.to), 0)
  const parseTo = Math.max(view.viewport.to, selectionEnd)
  const tree = ensureSyntaxTree(view.state, parseTo, 15) ?? syntaxTree(view.state)
  tree.iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter(nodeRef) {
      const node = nodeRef.node
      const name = node.name
      const active = selectionTouches(view, node.from, node.to)

      const heading = /^ATXHeading([1-6])$/.exec(name)
      if (heading) {
        addLineRange(view, lines, node.from, node.to, `cm-md-heading-${heading[1]}`)
        if (!active) {
          for (const child of descendants(node)) {
            if (child.name === 'HeaderMark') hide(child.from, child.to)
          }
        }
      }

      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        addLineRange(view, lines, node.from, node.to, name === 'SetextHeading1' ? 'cm-md-heading-1' : 'cm-md-heading-2')
        if (!active) {
          for (const child of descendants(node)) {
            if (child.name === 'SetextHeadingMark') hide(child.from, child.to)
          }
        }
      }

      if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough') {
        const marks = directChildren(node).filter(child =>
          child.name === 'EmphasisMark' || child.name === 'StrikethroughMark')
        if (marks.length >= 2) {
          const contentFrom = marks[0].to
          const contentTo = marks[marks.length - 1].from
          const className = name === 'Emphasis'
            ? 'cm-md-emphasis'
            : name === 'StrongEmphasis' ? 'cm-md-strong' : 'cm-md-strikethrough'
          mark(contentFrom, contentTo, className)
          if (!active) for (const delimiter of marks) hide(delimiter.from, delimiter.to)
        }
      }

      if (name === 'InlineCode') {
        const marks = directChildren(node).filter(child => child.name === 'CodeMark')
        const contentFrom = marks[0]?.to ?? node.from
        const contentTo = marks.at(-1)?.from ?? node.to
        mark(contentFrom, contentTo, 'cm-md-inline-code')
        if (!active) for (const delimiter of marks) hide(delimiter.from, delimiter.to)
      }

      if (name === 'Link') {
        const linkMarks = directChildren(node).filter(child => child.name === 'LinkMark')
        const labelFrom = linkMarks[0]?.to
        const labelTo = linkMarks[1]?.from
        if (labelFrom !== undefined && labelTo !== undefined) mark(labelFrom, labelTo, 'cm-md-link')
        if (!active) {
          for (const child of directChildren(node)) {
            const isLabel = labelFrom !== undefined && labelTo !== undefined
              && child.from >= labelFrom && child.to <= labelTo
            if (!isLabel) hide(child.from, child.to)
          }
        }
      }

      if (name === 'Image') {
        const children = directChildren(node)
        const urlNode = children.find(child => child.name === 'URL')
        const safeSrc = urlNode ? previewImageUrl(view.state.doc.sliceString(urlNode.from, urlNode.to)) : null
        const sameLine = view.state.doc.lineAt(node.from).number === view.state.doc.lineAt(node.to).number
        if (!active && safeSrc !== null && sameLine) {
          const marks = children.filter(child => child.name === 'LinkMark')
          const alt = marks.length >= 2 ? view.state.doc.sliceString(marks[0].to, marks[1].from) : ''
          decorations.push(Decoration.replace({
            widget: new ImagePreviewWidget(safeSrc, alt),
          }).range(node.from, node.to))
        } else {
          mark(node.from, node.to, 'cm-md-image-source')
        }
      }

      if (name === 'Blockquote') {
        addLineRange(view, lines, node.from, node.to, 'cm-md-blockquote')
        if (!active) {
          for (const child of descendants(node)) {
            if (child.name === 'QuoteMark') hide(child.from, child.to)
          }
        }
      }

      if (name === 'BulletList' || name === 'OrderedList') {
        addLineRange(view, lines, node.from, node.to, 'cm-md-list')
      }

      if (name === 'ListMark') {
        const lineNumber = view.state.doc.lineAt(node.from).number
        if (!selectionTouchesLine(view, lineNumber)) {
          const list = node.parent?.parent
          const ordered = list?.name === 'OrderedList'
          const source = view.state.doc.sliceString(node.from, node.to)
          widget(node.from, node.to, ordered ? source : '•', 'cm-md-list-marker')
        }
      }

      if (name === 'TaskMarker') {
        const lineNumber = view.state.doc.lineAt(node.from).number
        if (!selectionTouchesLine(view, lineNumber)) {
          const source = view.state.doc.sliceString(node.from, node.to)
          const complete = source.toLowerCase().includes('x')
          widget(
            node.from,
            node.to,
            complete ? '☑' : '□',
            'cm-md-task-marker',
            complete ? 'Completed task' : 'Incomplete task',
          )
        }
      }

      if (name === 'FencedCode') {
        addLineRange(view, lines, node.from, node.to, 'cm-md-code-block')
        if (!active) {
          for (const child of descendants(node)) {
            if (child.name === 'CodeMark' || child.name === 'CodeInfo') hide(child.from, child.to)
          }
        }
      }

      if (name === 'TableHeader') mark(node.from, node.to, 'cm-md-table-header')
      if (name === 'TableDelimiter') mark(node.from, node.to, 'cm-md-table-delimiter')
      if (name === 'HorizontalRule') addLineRange(view, lines, node.from, node.to, 'cm-md-horizontal-rule')

      return true
    },
  })

  for (const [from, classes] of lines) {
    decorations.push(Decoration.line({ class: [...classes].join(' ') }).range(from))
  }

  return Decoration.set(decorations, true)
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildLivePreview(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLivePreview(update.view)
      }
    }
  },
  { decorations: instance => instance.decorations },
)

const editorTheme = EditorView.theme({
  '&': {
    color: 'inherit',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: '0.9375rem',
  },
  '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
  '.cm-content': { minHeight: '20rem', padding: '0.75rem', caretColor: 'currentColor' },
  '.cm-line': { margin: '0', padding: '0 0.25rem', lineHeight: '1.75rem' },
  '.cm-gutters': { display: 'none' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'currentColor' },
  '.cm-selectionBackground': { backgroundColor: 'Highlight' },
  // 垂直间距包含在行盒内，保持显示坐标与光标命中的高度一致。
  '.cm-md-heading-1': { paddingTop: '1.25rem', paddingBottom: '0.5rem', fontSize: '1.25rem', fontWeight: '500', lineHeight: '1.4' },
  '.cm-md-heading-2': { paddingTop: '2.5rem', paddingBottom: '0.5rem', fontSize: '1.125rem', fontWeight: '500', lineHeight: '1.5' },
  '.cm-md-heading-3': { paddingTop: '1.5rem', paddingBottom: '0.5rem', fontSize: '1rem', fontWeight: '500' },
  '.cm-md-heading-4, .cm-md-heading-5, .cm-md-heading-6': { paddingTop: '1rem', paddingBottom: '0.5rem', fontSize: '1rem', fontWeight: '500' },
  '.cm-md-emphasis': { fontStyle: 'italic' },
  '.cm-md-strong': { fontWeight: '500' },
  '.cm-md-strikethrough': { textDecoration: 'line-through' },
  '.cm-md-inline-code': {
    borderRadius: '0.25rem',
    backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent)',
    padding: '0.1em 0.25em',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875em',
  },
  '.cm-md-link': { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '0.2em' },
  '.cm-md-image-source': { color: 'color-mix(in srgb, currentColor 65%, transparent)' },
  '.cm-md-image-preview': {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: '0.375rem',
    maxWidth: '100%',
    margin: '0.5rem 0',
    verticalAlign: 'middle',
  },
  '.cm-md-image-img': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '24rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--muted)',
    objectFit: 'contain',
  },
  '.cm-md-image-caption': {
    fontSize: '0.75rem',
    lineHeight: '1.25',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-image-fallback': {
    fontSize: '0.875rem',
    color: 'var(--muted-foreground)',
    textDecoration: 'underline',
  },
  '.cm-md-blockquote': {
    borderLeft: '2px solid color-mix(in srgb, currentColor 24%, transparent)',
    paddingLeft: '1rem',
    color: 'color-mix(in srgb, currentColor 72%, transparent)',
  },
  '.cm-md-list-marker, .cm-md-task-marker': {
    display: 'inline-block',
    minWidth: '1.5rem',
    color: 'color-mix(in srgb, currentColor 65%, transparent)',
    textAlign: 'center',
  },
  '.cm-md-code-block': {
    backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875rem',
  },
  '.cm-md-table-header': { fontWeight: '600' },
  '.cm-md-table-delimiter': { color: 'color-mix(in srgb, currentColor 45%, transparent)' },
  '.cm-md-horizontal-rule': { color: 'color-mix(in srgb, currentColor 45%, transparent)' },
})

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { id, labelId, value, onChange },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const insertionPoints = useRef(new Set<{ position: number }>())

  useImperativeHandle(ref, () => ({
    prepareImageInsertion() {
      const view = viewRef.current
      if (!view) return null
      const point = { position: view.state.selection.main.head }
      const points = insertionPoints.current
      points.add(point)
      return {
        release: () => { points.delete(point) },
        insert(markdownImage) {
          if (viewRef.current !== view || !points.delete(point)) return false
          const position = point.position
          const before = position > 0 ? view.state.doc.sliceString(position - 1, position) : ''
          const after = position < view.state.doc.length ? view.state.doc.sliceString(position, position + 1) : ''
          const prefix = before && !/\s/u.test(before) ? ' ' : ''
          const suffix = after && !/\s/u.test(after) ? ' ' : ''
          view.dispatch({
            changes: { from: position, insert: `${prefix}${markdownImage}${suffix}` },
            selection: { anchor: position + prefix.length + markdownImage.length },
            userEvent: 'input',
          })
          view.focus()
          return true
        },
      }
    },
  }), [])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const parent = parentRef.current
    if (!parent) return

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        markdown({ base: commonmarkLanguage, extensions: GFM, pasteURLAsLink: false }),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          id,
          role: 'textbox',
          'aria-labelledby': labelId,
          'aria-multiline': 'true',
          spellcheck: 'true',
        }),
        EditorView.updateListener.of(update => {
          if (update.transactions.some(transaction => transaction.annotation(externalDocumentChange))) {
            insertionPoints.current.clear()
          } else if (update.docChanged) {
            for (const point of insertionPoints.current) point.position = update.changes.mapPos(point.position, 1)
          }
          if (update.docChanged && update.transactions.some(transaction =>
            transaction.docChanged && !transaction.annotation(externalDocumentChange))) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        livePreview,
        editorTheme,
      ],
    })
    const view = new EditorView({ state, parent })
    const points = insertionPoints.current
    viewRef.current = view

    return () => {
      points.clear()
      view.destroy()
      viewRef.current = null
    }
  }, [id, labelId])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: externalDocumentChange.of(true),
    })
  }, [value])

  return (
    <div className="min-h-80 rounded-lg border border-border bg-transparent text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-offset-4">
      <div ref={parentRef} />
    </div>
  )
})
