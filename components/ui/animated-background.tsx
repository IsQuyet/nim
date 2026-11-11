'use client'
import { cn } from '@/lib/utils'
import { AnimatePresence, Transition, motion } from 'motion/react'
import {
  Children,
  cloneElement,
  ReactElement,
  HTMLAttributes,
  useState,
  useId,
} from 'react'

type AnimatedBackgroundItemProps = HTMLAttributes<HTMLElement> & {
  'data-id': string
  'data-checked'?: 'true' | 'false'
}

export type AnimatedBackgroundProps = {
  children:
    | ReactElement<AnimatedBackgroundItemProps>[]
    | ReactElement<AnimatedBackgroundItemProps>
  /** 受控选中项，null 表示清空选择。 */
  value?: string | null
  /** 非受控初始值，后续变化不覆盖内部选择。 */
  defaultValue?: string
  onValueChange?: (newActiveId: string | null) => void
  className?: string
  transition?: Transition
  enableHover?: boolean
}

export function AnimatedBackground({
  children,
  value,
  defaultValue,
  onValueChange,
  className,
  transition,
  enableHover = false,
}: AnimatedBackgroundProps) {
  const [internalActiveId, setInternalActiveId] = useState<string | null>(
    defaultValue ?? null,
  )
  const isControlled = value !== undefined
  const activeId = isControlled ? value : internalActiveId
  const uniqueId = useId()

  const handleSetActiveId = (id: string | null) => {
    if (!isControlled) {
      setInternalActiveId(id)
    }

    if (onValueChange) {
      onValueChange(id)
    }
  }

  return Children.map(children, (child, index) => {
    const id = child.props['data-id']

    const interactionProps = enableHover
      ? {
          onMouseEnter: () => handleSetActiveId(id),
          onMouseLeave: () => handleSetActiveId(null),
        }
      : {
          onClick: () => handleSetActiveId(id),
        }

    return cloneElement(
      child,
      {
        key: index,
        className: cn('relative inline-flex', child.props.className),
        'data-checked': activeId === id ? 'true' : 'false',
        ...interactionProps,
      },
      <>
        <AnimatePresence initial={false}>
          {activeId === id && (
            <motion.div
              layoutId={`background-${uniqueId}`}
              className={cn('absolute inset-0', className)}
              transition={transition}
              initial={{ opacity: (value ?? defaultValue) ? 1 : 0 }}
              animate={{
                opacity: 1,
              }}
              exit={{
                opacity: 0,
              }}
            />
          )}
        </AnimatePresence>
        <div className="z-10">{child.props.children}</div>
      </>,
    )
  })
}
