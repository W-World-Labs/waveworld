'use client';

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

/** Keep incomplete numeric edits in the field; commit physical values on blur/Enter. */
function NumberInput({ value, onValueChange, integer, onBlur, onKeyDown, ...props }: Omit<React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "ref"> & {
  value: number | ""
  onValueChange: (value: number) => void
  integer?: boolean
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (ref.current) ref.current.value = String(value)
  }, [value])

  return <Input {...props} ref={ref} type="number" defaultValue={value}
    onBlur={event => {
      const field = event.currentTarget
      const next = field.valueAsNumber
      if (Number.isFinite(next) && (!integer || Number.isSafeInteger(next)) &&
          !field.validity.rangeUnderflow && !field.validity.rangeOverflow) {
        if (next !== value) onValueChange(next)
        field.value = String(next)
      } else field.value = String(value)
      onBlur?.(event)
    }}
    onKeyDown={event => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key === "Escape") event.currentTarget.value = String(value)
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault()
        event.currentTarget.blur()
      }
    }} />
}

export { Input, NumberInput }
