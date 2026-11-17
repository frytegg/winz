import { motion } from 'motion/react';
import { TextAnimate } from '@/components/magicui/text-animate';

export function Section({ inView }: { inView: boolean }) {
  return (
    <section>
      <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        How it settles
      </motion.h2>
      <TextAnimate animation="blurInUp">Two seconds on testnet</TextAnimate>
      <p className={inView ? 'animate-in fade-in slide-in-from-bottom-4' : 'opacity-0'}>Escrow releases on delivery.</p>
    </section>
  );
}
