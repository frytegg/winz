import { cva } from 'class-variance-authority';

// A primitive no page imports.
export const buttonVariants = cva('inline-flex items-center', {
  variants: { variant: { default: 'bg-primary text-primary-foreground hover:bg-primary/90' } },
});
