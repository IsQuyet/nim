import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownImageUpload } from './image-upload'

const fetchMock = vi.fn<typeof fetch>()
const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

function success(uploadId: string) {
  return Response.json({ status: 'success', media: {
    id: uploadId, originalName: 'photo[1].png', mediaType: 'image/webp', width: 2, height: 3, url: `/media/${uploadId}`,
  } })
}

function selectedFile() {
  const file = new File(['image bytes'], 'photo[1].png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [file] } })
  return file
}

function sentForm(index = 0) {
  const body = fetchMock.mock.calls[index]?.[1]?.body
  if (!(body instanceof FormData)) throw new Error('The upload must send FormData.')
  return body
}

function sentId(index = 0) {
  const value = sentForm(index).get('id')
  if (typeof value !== 'string') throw new Error('The upload must keep its ID.')
  return value
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('明确上传并插入图片', () => {
  it('选择文件不发请求，明确上传后验证身份再插入转义后的 Markdown', async () => {
    const insert = vi.fn(() => true)
    const release = vi.fn()
    const prepareInsertion = vi.fn(() => ({ insert, release }))
    fetchMock.mockImplementation(async () => success(sentId()))
    render(<MarkdownImageUpload prepareInsertion={prepareInsertion} />)
    selectedFile()
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }))
    await waitFor(() => expect(insert).toHaveBeenCalledWith(`![photo\\[1\\]](/media/${sentId()})`))
    expect(prepareInsertion).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Upload and insert' })).toBeNull()
  })

  it('网络未知结果不自动重试，明确重试沿用同一文件、ID 和插入点', async () => {
    const insert = vi.fn(() => true)
    const prepareInsertion = vi.fn(() => ({ insert, release: vi.fn() }))
    fetchMock.mockRejectedValueOnce(new Error('Connection lost'))
    render(<MarkdownImageUpload prepareInsertion={prepareInsertion} />)
    selectedFile()
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }))
    await screen.findByText('Connection lost')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
    fetchMock.mockImplementation(async () => success(sentId(1)))
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    expect(sentId(1)).toBe(sentId())
    expect(sentForm(1).get('file')).toEqual(sentForm().get('file'))
    expect(prepareInsertion).toHaveBeenCalledTimes(1)
  })

  it('响应中的图片身份与本次上传不符时，不插入正文', async () => {
    const insert = vi.fn(() => true)
    fetchMock.mockResolvedValue(success(id))
    render(<MarkdownImageUpload prepareInsertion={() => ({ insert, release: vi.fn() })} />)
    selectedFile()
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }))
    await screen.findByText('The upload response belongs to a different image.')
    expect(insert).not.toHaveBeenCalled()
  })

  it('文章切换或卸载后终止等待，迟到的成功响应不插入正文', async () => {
    let finish: ((response: Response) => void) | undefined
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const insert = vi.fn(() => true)
    const release = vi.fn()
    const mounted = render(<MarkdownImageUpload prepareInsertion={() => ({ insert, release })} />)
    selectedFile()
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }))
    const signal = fetchMock.mock.calls[0]?.[1]?.signal
    mounted.unmount()
    expect(signal?.aborted).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
    await act(async () => finish?.(success(sentId())))
    expect(insert).not.toHaveBeenCalled()
  })

  it('插入点失效时保留已上传资源，只有明确再次插入才修改新的正文', async () => {
    const previous = { insert: vi.fn(() => false), release: vi.fn() }
    const current = { insert: vi.fn(() => true), release: vi.fn() }
    const prepareInsertion = vi.fn().mockReturnValueOnce(previous).mockReturnValueOnce(current)
    fetchMock.mockImplementation(async () => success(sentId()))
    render(<MarkdownImageUpload prepareInsertion={prepareInsertion} />)
    selectedFile()
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }))
    const button = await screen.findByRole('button', { name: 'Insert uploaded image' })
    expect(current.insert).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(current.insert).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('上传后允许再次选择同一文件，重新选择才建立新的上传身份', async () => {
    const prepareInsertion = () => ({ insert: () => true, release: vi.fn() })
    fetchMock.mockImplementation(async () => success(sentId(fetchMock.mock.calls.length - 1)))
    render(<MarkdownImageUpload prepareInsertion={prepareInsertion} />)
    selectedFile()
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Upload and insert' })).toBeNull())
    selectedFile()
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(sentId(1)).not.toBe(sentId())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Upload and insert' })).toBeNull())
  })
})
