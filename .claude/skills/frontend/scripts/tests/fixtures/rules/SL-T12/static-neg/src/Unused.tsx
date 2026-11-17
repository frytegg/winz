import { motion } from 'motion/react';

// FD14-F12: a vendored effect no page renders.
export function Unused() {
  return <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}>Never mounted</motion.div>;
}
