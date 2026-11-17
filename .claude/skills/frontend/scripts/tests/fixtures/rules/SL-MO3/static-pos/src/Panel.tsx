import { motion } from 'motion/react';

export function Panel() {
  return (
    <>
      <div className="transition-opacity duration-700">Panel</div>
      <motion.div animate={{ x: 0 }} transition={{ duration: 0.6 }} />
    </>
  );
}
