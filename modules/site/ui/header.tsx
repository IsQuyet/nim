import Link from 'next/link'
import { AdminEntry } from '@/modules/auth/ui/admin-entry'
import { SearchTrigger } from '@/modules/search/ui/search-command'
import { routes } from '@/lib/routes'
import { PROFILE } from '../data'
import { NavigationDrawer, PinnedNavigation } from './site-navigation'
import { ThemeMenu } from './theme-menu'

export function Header() {
  return (
    <header className="sticky top-0 z-40 h-(--header-height) border-b bg-background/80 backdrop-blur-xl">
      <div className="canvas flex h-full items-center gap-2">
        <NavigationDrawer title={PROFILE.name} />
        <Link href={routes.home} className="mr-4 font-medium">
          {PROFILE.name}
        </Link>
        <PinnedNavigation />
        <div className="ml-auto flex items-center gap-1">
          <SearchTrigger />
          <ThemeMenu />
          <AdminEntry />
        </div>
      </div>
    </header>
  )
}
