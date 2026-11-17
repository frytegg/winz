import { motion } from 'motion/react';

export function Menu() {
  return (
    <>
      <div className="data-[state=open]:animate-in fade-in-0 zoom-in-95 ease-in">Menu</div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ease: 'easeIn' }} />
    </>
  );
}
