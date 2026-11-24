import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "@radix-ui/react-slot"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-sm whitespace-nowrap transition-colors duration-200 outline-offset-2 outline-ring focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 aria-busy:cursor-wait [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-background hover:bg-destructive/85",
        link: "rounded-sm underline underline-offset-4 hover:text-muted-foreground",
        quiet: "rounded-sm text-muted-foreground hover:text-foreground",
      },
      size: {
        default: "h-8 px-3.5",
        sm: "h-7 px-3",
        lg: "h-10 px-5",
        icon: "size-8",
        "icon-sm": "size-7",
        text: "",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
