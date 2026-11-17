import BlurText from './BlurText';
import AnimatedContent from './AnimatedContent';
import { MagicCard } from '@/components/magicui/magic-card';
import { Spotlight } from '@/components/ui/spotlight';

export function Hero() {
  return (
    <>
      <Spotlight className="-top-40" fill="white" />
      <BlurText text="Welcome to the future" delay={150} />
      <MagicCard gradientColor="#262626">Card</MagicCard>
    </>
  );
}

export const unused = AnimatedContent;
