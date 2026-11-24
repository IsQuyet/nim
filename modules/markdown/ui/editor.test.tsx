import { createRef } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownEditor, type MarkdownEditorHandle } from './editor'

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

  it('将上传的图片 Markdown 插入当前光标并通知父写作会话', () => {
    const onChange = vi.fn()
    const editorRef = createRef<MarkdownEditorHandle>()
    render(
      <>
        <label id="body-label">Body</label>
        <MarkdownEditor ref={editorRef} id="body" labelId="body-label" value="Before after" onChange={onChange} />
      </>,
    )
    const view = editor()
    act(() => view.dispatch({ selection: { anchor: 7 } }))
    const insertion = editorRef.current?.prepareImageInsertion()
    act(() => expect(insertion?.insert('![photo](/media/264efa5a-5f48-4f4d-bbc3-56021a5f6342)')).toBe(true))

    const expected = 'Before ![photo](/media/264efa5a-5f48-4f4d-bbc3-56021a5f6342) after'
    expect(view.state.doc.toString()).toBe(expected)
    expect(onChange).toHaveBeenLastCalledWith(expected)
  })

  it('上传开始时的插入点随输入移动，不追随之后移动的光标，也不替换新输入', () => {
    const editorRef = createRef<MarkdownEditorHandle>()
    render(<><label id="body-label">Body</label><MarkdownEditor ref={editorRef} id="body" labelId="body-label" value="Before after" onChange={() => {}} /></>)
    const view = editor()
    act(() => view.dispatch({ selection: { anchor: 7 } }))
    const insertion = editorRef.current?.prepareImageInsertion()
    act(() => view.dispatch({ changes: { from: 0, insert: 'New ' }, selection: { anchor: 0 } }))
    act(() => expect(insertion?.insert('![photo](/media/example)')).toBe(true))
    expect(view.state.doc.toString()).toBe('New Before ![photo](/media/example) after')
    expect(insertion?.insert('duplicate')).toBe(false)
  })

  it('外部替换正文后旧插入点失效，不让迟到的上传修改恢复内容', () => {
    const editorRef = createRef<MarkdownEditorHandle>()
    const renderEditor = (value: string) => <><label id="body-label">Body</label><MarkdownEditor ref={editorRef} id="body" labelId="body-label" value={value} onChange={() => {}} /></>
    const mounted = render(renderEditor('Old document'))
    const insertion = editorRef.current?.prepareImageInsertion()
    mounted.rerender(renderEditor('Restored document'))
    expect(insertion?.insert('![photo](/media/example)')).toBe(false)
    expect(editor().state.doc.toString()).toBe('Restored document')
  })

  it('释放插入点或卸载编辑器后不再修改文档', () => {
    const editorRef = createRef<MarkdownEditorHandle>()
    const mounted = render(<><label id="body-label">Body</label><MarkdownEditor ref={editorRef} id="body" labelId="body-label" value="Document" onChange={() => {}} /></>)
    const released = editorRef.current?.prepareImageInsertion()
    released?.release()
    expect(released?.insert('late image')).toBe(false)
    const pending = editorRef.current?.prepareImageInsertion()
    mounted.unmount()
    expect(pending?.insert('late image')).toBe(false)
  })

  it('光标离开合法图片语法时就地呈现图片，光标进入后揭示源码，且拒绝不安全或相对路径图片', async () => {
    const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
    const mediaSyntax = `![Architecture diagram](/media/${id})`
    const source = `Intro\n\n${mediaSyntax}\n\n![Relative](image.png)\n\n![Unsafe](javascript:alert(1))`
    render(
      <>
        <label id="body-label">Body</label>
        <MarkdownEditor id="body" labelId="body-label" value={source} onChange={() => {}} />
      </>,
    )

    const view = editor()
    act(() => view.dispatch({ selection: { anchor: 0 } }))

    await waitFor(() => expect(view.dom.querySelector(`img[src="/media/${id}"]`)).not.toBeNull())
    const rendered = view.dom.querySelector<HTMLImageElement>(`img[src="/media/${id}"]`)!
    expect(rendered.alt).toBe('Architecture diagram')
    expect(view.contentDOM.textContent).not.toContain(`/media/${id}`)
    expect(view.contentDOM.textContent).toContain('![Relative](image.png)')
    expect(view.contentDOM.textContent).toContain('![Unsafe](javascript:alert(1))')
    expect(view.dom.querySelectorAll('img.cm-md-image-img')).toHaveLength(1)

    const imageOffset = source.indexOf(mediaSyntax) + 4
    act(() => view.dispatch({ selection: { anchor: imageOffset } }))
    expect(view.dom.querySelector(`img[src="/media/${id}"]`)).toBeNull()
    expect(view.contentDOM.textContent).toContain(mediaSyntax)
    expect(view.state.doc.toString()).toBe(source)
  })
})
