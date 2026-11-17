import { motion } from 'motion/react';
import { TextAnimate } from '@/components/magicui/text-animate';

// One orchestrated load moment, a TextAnimate told not to wait for the viewport, and a docs string.
export const tip = 'Avoid whileInView={{ opacity: 1 }} on body copy.';

export function Intro() {
  return (
    <section>
      <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Escrow that settles on delivery</motion.h1>
      <TextAnimate startOnView={false}>Two seconds on testnet</TextAnimate>
      {/* <motion.div whileInView={{ opacity: 1 }} /> */}
    </section>
  );
}
