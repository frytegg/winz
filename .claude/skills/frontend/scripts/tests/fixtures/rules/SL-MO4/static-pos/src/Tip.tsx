import { motion } from 'motion/react';

export function Tip() {
  return (
    <div className="group">
      <span className="scale-0 transition-transform group-hover:scale-100">Tip</span>
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} />
    </div>
  );
}
