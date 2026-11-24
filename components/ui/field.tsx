import * as React from "react"
import { cn } from "@/lib/utils"

const fieldClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-foreground outline-offset-2 outline-ring placeholder:text-muted-foreground focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60"

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(fieldClassName, className)} {...props} />
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldClassName, className)} {...props} />
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("block w-fit text-sm font-medium", className)} {...props} />
}

export { Input, Label, Textarea }
