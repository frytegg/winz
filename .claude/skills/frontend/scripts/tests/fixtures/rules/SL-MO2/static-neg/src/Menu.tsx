import { motion } from 'motion/react';

export function Menu() {
  return (
    <>
      <div className="data-[state=closed]:animate-out fade-out-0 data-[state=closed]:ease-in">Menu</div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { ease: 'easeIn' } }} />
    </>
  );
}
