'use client'
import { TextLoop } from '@/components/ui/text-loop'

export function Footer() {
  return (
    <footer className="border-t">
      <div className="canvas flex h-14 items-center">
        <a href="https://github.com/ibelick/nim" target="_blank">
          <TextLoop className="text-xs text-muted-foreground">
            <span>© 2024 Nim.</span>
            <span>Built with Motion-Primitives.</span>
          </TextLoop>
        </a>
      </div>
    </footer>
  )
}
