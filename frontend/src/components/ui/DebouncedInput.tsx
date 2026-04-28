import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  onSearch: (value: string) => void
  delay?: number
  externalValue?: string
}

export interface DebouncedInputHandle {
  clear: () => void
  focus: () => void
}

const DebouncedInput = forwardRef<DebouncedInputHandle, Props>(
  ({ onSearch, delay = 1200, externalValue, ...props }, ref) => {
    const [value, setValue] = useState(externalValue ?? '')
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      clear: () => { setValue(''); onSearch('') },
      focus: () => inputRef.current?.focus(),
    }))

    useEffect(() => {
      if (externalValue !== undefined && externalValue !== value) setValue(externalValue)
    }, [externalValue])

    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => {
          const v = e.target.value
          setValue(v)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => onSearch(v), delay)
        }}
        {...props}
      />
    )
  }
)

DebouncedInput.displayName = 'DebouncedInput'
export default DebouncedInput
