import type { InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onInput' | 'onChange'> & {
  onValueChange: (value: string) => void
}

/** Calendar controls can emit input without React's synthesized change noticing the value. */
export default function DateInput({ onValueChange, ...props }: Props) {
  return (
    <input
      {...props}
      type="date"
      onInput={(event) => onValueChange(event.currentTarget.value)}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    />
  )
}
