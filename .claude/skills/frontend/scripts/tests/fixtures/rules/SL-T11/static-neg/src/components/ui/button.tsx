import { cva } from 'class-variance-authority';

export const buttonVariants = cva('inline-flex items-center justify-center rounded-sm text-sm font-semibold', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary-strong active:translate-y-px',
      // default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      outline: 'border bg-background hover:bg-accent',
    },
  },
});
