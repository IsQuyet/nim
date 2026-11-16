import { act, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownEditor } from '@/components/markdown-editor'

function editor() {
  const content = screen.getByRole<HTMLDivElement>('textbox', { name: 'Body' })
  const view = EditorView.findFromDOM(content)
  if (!view) throw new Error('CodeMirror editor was not mounted.')
  return view
}

describe('Markdown 实时编辑器', () => {
  it('就地呈现常用 Markdown 标记，光标进入后显示语法，源文档保持原样', async () => {
    const onChange = vi.fn()
    render(
      <>
        <label id="body-label">Body</label>
        <MarkdownEditor id="body" labelId="body-label" value="" onChange={onChange} />
      </>,
    )

    const source = '# Title\n\n**bold** and *italic* ~~removed~~ with `code` and [link](https://example.test).'
    const view = editor()
    act(() => view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
      selection: { anchor: source.length },
    }))

    expect(view.state.doc.toString()).toBe(source)
    expect(onChange).toHaveBeenLastCalledWith(source)
    await waitFor(() => expect(view.dom.querySelector('.cm-md-link')).not.toBeNull(), { timeout: 10_000 })
    expect(view.dom.querySelector('.cm-md-heading-1')).toBeDefined()
    expect(view.dom.querySelector('.cm-md-strong')?.textContent).toContain('bold')
    expect(view.dom.querySelector('.cm-md-emphasis')?.textContent).toContain('italic')
    expect(view.dom.querySelector('.cm-md-strikethrough')?.textContent).toContain('removed')
    expect(view.dom.querySelector('.cm-md-inline-code')?.textContent).toContain('code')
    expect(view.dom.querySelector('.cm-md-link')?.textContent).toContain('link')
    expect(view.contentDOM.textContent).not.toContain('# Title')
    expect(view.contentDOM.textContent).not.toContain('**bold**')
    expect(view.contentDOM.textContent).not.toContain('https://example.test')

    act(() => view.dispatch({ selection: { anchor: 2 } }))
    expect(view.contentDOM.textContent).toContain('# Title')
    expect(view.state.doc.toString()).toBe(source)
  }, 15_000)

  it('外部恢复或切换服务器文本不会回报成新的用户输入', async () => {
    const onChange = vi.fn()
    const renderResult = render(
      <>
        <label id="body-label">Body</label>
        <MarkdownEditor id="body" labelId="body-label" value="Initial" onChange={onChange} />
      </>,
    )

    const view = editor()
    act(() => view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'Local edit' },
    }))
    expect(onChange).toHaveBeenLastCalledWith('Local edit')
    onChange.mockClear()

    await act(async () => renderResult.rerender(
      <>
        <label id="body-label">Body</label>
        <MarkdownEditor id="body" labelId="body-label" value="Recovered server text" onChange={onChange} />
      </>,
    ))

    expect(view.state.doc.toString()).toBe('Recovered server text')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('保留 GFM 任务列表的源语法并在正文位置呈现状态标记', () => {
    const source = '- [x] complete\n- [ ] continue\n\nOutside'
    render(
      <>
        <label id="body-label">Body</label>
        <MarkdownEditor id="body" labelId="body-label" value={source} onChange={() => {}} />
      </>,
    )

    const view = editor()
    act(() => view.dispatch({ selection: { anchor: source.length } }))

    expect(view.state.doc.toString()).toBe(source)
    expect(view.contentDOM.textContent).toContain('☑')
    expect(view.contentDOM.textContent).toContain('□')
    expect(view.contentDOM.textContent).not.toContain('[x]')
    expect(view.contentDOM.textContent).not.toContain('[ ]')
  })

  it('不把 Markdown 图片伪装成已经渲染的图片', () => {
    const source = '![alt text](image.png)'
    render(
      <>
        <label id="body-label">Body</label>
        <MarkdownEditor id="body" labelId="body-label" value={source} onChange={() => {}} />
      </>,
    )

    expect(editor().contentDOM.textContent).toContain(source)
  })
})
