import { MotionConfig, motion } from 'motion/react';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div initial={{ y: 20 }} animate={{ y: 0 }}>
        Arrive
      </motion.div>
      <div className="motion-safe:animate-bounce">Scroll</div>
      <div className="animate-pulse">Loading</div>
      <div className="animate-spin">Spinner</div>
    </MotionConfig>
  );
}
