'use client';

// Trimmed from Magic UI's TextAnimate (MIT, https://magicui.design/docs/components/text-animate), as vendored in
// inflexion apps/web/components/magicui/text-animate.tsx: the reveal is gated by startOnView, true by default.
import { memo } from 'react';
import { motion, type MotionProps } from 'motion/react';

interface TextAnimateProps extends Omit<MotionProps, 'children'> {
  children: string;
  startOnView?: boolean;
  once?: boolean;
}

const TextAnimateBase = ({ children, startOnView = true, once = false, ...props }: TextAnimateProps) => {
  return (
    <motion.div
      initial="hidden"
      whileInView={startOnView ? 'show' : undefined}
      animate={startOnView ? undefined : 'show'}
      exit="exit"
      viewport={{ once }}
      {...props}
    >
      {children}
    </motion.div>
  );
};

export const TextAnimate = memo(TextAnimateBase);
