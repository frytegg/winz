import { motion } from 'motion/react';

export function Hero() {
  return (
    <section>
      <motion.div initial={{ y: 20 }} animate={{ y: 0 }}>
        Arrive
      </motion.div>
      <div className="animate-bounce">Scroll</div>
    </section>
  );
}
