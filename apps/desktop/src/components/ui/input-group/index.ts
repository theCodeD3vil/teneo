import type { VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'vue'
import type { ButtonVariants } from '@/components/ui/button'
import { cva } from 'class-variance-authority'

export { default as InputGroup } from './InputGroup.vue'
export { default as InputGroupAddon } from './InputGroupAddon.vue'
export { default as InputGroupButton } from './InputGroupButton.vue'
export { default as InputGroupInput } from './InputGroupInput.vue'
export { default as InputGroupText } from './InputGroupText.vue'
export { default as InputGroupTextarea } from './InputGroupTextarea.vue'

export const inputGroupVariants = cva(
  'border-transparent dark:bg-input/30 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 h-9 rounded-md border shadow-xs transition-[color,box-shadow] in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-3 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5 group/input-group relative flex w-full min-w-0 items-center outline-none has-[>textarea]:h-auto',
  {
    variants: {
      variant: {
        default: '',
        transparent: 'border-0 shadow-none dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:ring-0',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type InputGroupRootVariants = VariantProps<typeof inputGroupVariants>

export const inputGroupAddonVariants = cva(
  'text-muted-foreground h-auto gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*=size-])]:size-4 flex cursor-text items-center justify-center select-none',
  {
    variants: {
      align: {
        'inline-start': 'pl-2 has-[>button]:-ml-1 has-[>kbd]:ml-[-0.15rem] order-first',
        'inline-end': 'pr-2 has-[>button]:-mr-1 has-[>kbd]:mr-[-0.15rem] order-last',
        'block-start': 'px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2 order-first w-full justify-start',
        'block-end': 'px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2 order-last w-full justify-start',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

export type InputGroupVariants = VariantProps<typeof inputGroupAddonVariants>

export const inputGroupButtonVariants = cva(
  'gap-2 text-sm flex items-center shadow-none',
  {
    variants: {
      size: {
        'xs': 'h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-1.5 [&>svg:not([class*=size-])]:size-3.5',
        'sm': '',
        'icon-xs': 'size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0',
        'icon-sm': 'size-8 p-0 has-[>svg]:p-0',
      },
    },
    defaultVariants: {
      size: 'xs',
    },
  },
)

export type InputGroupButtonVariants = VariantProps<typeof inputGroupButtonVariants>

export interface InputGroupButtonProps {
  variant?: ButtonVariants['variant']
  size?: InputGroupButtonVariants['size']
  class?: HTMLAttributes['class']
}
