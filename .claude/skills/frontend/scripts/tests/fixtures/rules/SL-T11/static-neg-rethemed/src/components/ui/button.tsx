import { cva } from 'class-variance-authority';

// XRPL's radix-nova primitive kept its variant string; the theme behind --primary is the brand's gold (FD14-F03: not a hit).
export const buttonVariants = cva('inline-flex items-center justify-center rounded-lg text-sm font-medium', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/80',
    },
  },
});
