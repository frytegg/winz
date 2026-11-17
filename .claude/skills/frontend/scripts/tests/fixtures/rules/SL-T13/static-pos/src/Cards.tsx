import { MagicCard } from '@/components/magicui/magic-card';
import { Spotlight } from '@/components/ui/spotlight';

export function Cards() {
  return (
    <div>
      <Spotlight className="-top-40 left-0" fill="white" />
      <MagicCard gradientColor="#262626">Vaults</MagicCard>
    </div>
  );
}
