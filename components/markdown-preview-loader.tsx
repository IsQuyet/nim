'use client'

import { Component, type ReactNode } from 'react'
import dynamic from 'next/dynamic'

const Preview = dynamic(() => import('./markdown-preview').then(module => module.MarkdownPreview), {
  ssr: false,
  loading: () => <p role="status">Loading preview…</p>,
})

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <p role="alert">Preview could not be loaded. Keep editing or save your draft before reloading.</p>
    }
    return this.props.children
  }
}

export function MarkdownPreviewLoader({ source }: { source: string }) {
  return <PreviewBoundary><Preview source={source} /></PreviewBoundary>
}
