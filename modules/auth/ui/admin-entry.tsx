'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FilePlusIcon, FilesIcon, LogOutIcon, UserRoundIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { routes } from '@/lib/routes'
import { authClient } from '../client'
import { signOut } from './sign-out'

/**
 * 页头的管理入口。未登录时是通向管理页的链接，登录后是管理菜单。
 * 登录状态在浏览器里读取，页面的服务器输出对所有访客相同。入口是否显示不决定权限，权限由服务器检查。
 */
export function AdminEntry() {
  const router = useRouter()
  const pathname = usePathname()
  const session = authClient.useSession()
  const [failed, setFailed] = useState(false)

  if (!session.data) {
    return (
      <Button asChild variant="ghost" size="icon">
        <Link href={routes.admin.home} aria-label="Admin">
          <UserRoundIcon />
        </Link>
      </Button>
    )
  }

  async function handleSignOut() {
    if (!(await signOut())) {
      setFailed(true)
      return
    }
    await session.refetch()
    if (pathname.startsWith(routes.admin.home)) router.replace(routes.admin.login)
    router.refresh()
  }

  return (
    <DropdownMenu onOpenChange={() => setFailed(false)}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Admin menu">
          <UserRoundIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={routes.admin.home}>
            <FilesIcon />
            Content
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={routes.admin.newPost}>
            <FilePlusIcon />
            New draft
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault()
            void handleSignOut()
          }}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
        {failed && (
          <p role="alert" className="max-w-52 px-2.5 py-1.5 text-xs text-destructive">
            Could not complete sign-out. Please try again.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
