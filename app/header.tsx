'use client'
import { TextEffect } from '@/components/ui/text-effect'
import Link from 'next/link'
import { routes } from '@/lib/routes'
import { PROFILE } from './data'

export function Header() {
  return (
    <header className="mb-8 flex items-center justify-between">
      <div>
        <Link href={routes.home} className="font-medium text-foreground">
          {PROFILE.name}
        </Link>
        <TextEffect
          as="p"
          preset="fade"
          per="char"
          className="text-muted-foreground"
          delay={0.5}
        >
          {PROFILE.role}
        </TextEffect>
      </div>
    </header>
  )
}
