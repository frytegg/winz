import { cva } from 'class-variance-authority';

export const buttonVariants = cva('inline-flex items-center justify-center rounded-md text-sm font-medium', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      outline: 'border bg-background hover:bg-accent',
    },
  },
});
