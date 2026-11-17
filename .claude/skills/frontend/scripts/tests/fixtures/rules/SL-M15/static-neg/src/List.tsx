import { useState } from 'react';
import { Card } from '@/components/ui/card';

type Item = { id: string };

export function List() {
  const [selected] = useState<Card | null>(null);
  const items: Array<Item> = [];
  return (
    <div className="grid gap-4">
      <Card>One</Card>
      <Card>Two</Card>
      <div className="rounded-xl border p-4">Three {String(selected)} {items.length}</div>
    </div>
  );
}
