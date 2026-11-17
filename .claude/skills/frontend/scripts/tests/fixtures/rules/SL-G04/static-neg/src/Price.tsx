import { NumberTicker } from '@/components/magicui/number-ticker';
import { Folder, Sparkles } from 'lucide-react';
import Marquee from 'react-fast-marquee';

export function Price({ price }: { price: number }) {
  return (
    <div>
      <NumberTicker value={price} />
      <Folder className="size-4" />
      <Sparkles className="size-4" />
      <Marquee>news</Marquee>
    </div>
  );
}
