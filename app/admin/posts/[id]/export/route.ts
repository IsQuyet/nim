import { unstable_rethrow } from 'next/navigation'
import { withAdminPostStore } from '@/modules/posts/server/admin'
import { exportPostMarkdown, postFileStageSchema } from '@/lib/post-files'

function errorResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const result = await withAdminPostStore(async store => {
      const { id } = await params
      const stages = new URL(request.url).searchParams.getAll('stage')
      if (stages.length > 1) return errorResponse('Choose exactly one export stage.', 400)
      const stage = postFileStageSchema.safeParse(stages[0] ?? 'draft')
      if (!stage.success) return errorResponse('The export stage must be draft or published.', 400)
      const file = exportPostMarkdown(store, id, stage.data)
      if (file.status === 'missing') return errorResponse('This saved snapshot does not exist.', 404)
      if (file.status === 'invalid') return errorResponse(file.message, 422)
      return new Response(file.source, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file.filename}"`,
          'Cache-Control': 'private, no-store',
        },
      })
    })
    if (!result.authorized) return errorResponse('Sign in to download a saved Markdown snapshot.', 401)
    return result.value
  } catch (error) {
    unstable_rethrow(error)
    console.error('导出 Markdown 文件失败。', error)
    return errorResponse('Could not export the Markdown file. Please try again.', 500)
  }
}
