import { motion } from 'motion/react';

export function Tip() {
  return (
    <div className="group">
      <span className="transition-transform group-hover:scale-0">Hide on hover</span>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} />
    </div>
  );
}
