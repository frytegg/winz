import { Coins, Globe, Users } from 'lucide-react';

const benefits = [
  { icon: Coins, title: 'Low fees', body: 'Pay less.' },
  { icon: Globe, title: 'Global', body: 'Anywhere.' },
  { icon: Users, title: 'Community', body: 'Together.' },
];

export function Benefits() {
  return (
    <div className="grid grid-cols-3 gap-6">
      {benefits.map((b) => (
        <div key={b.title}>
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
            <b.icon className="size-6" />
          </div>
          <h3>{b.title}</h3>
        </div>
      ))}
    </div>
  );
}
