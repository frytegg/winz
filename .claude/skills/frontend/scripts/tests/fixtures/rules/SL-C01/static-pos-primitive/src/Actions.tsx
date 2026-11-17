import { Button } from '@/components/ui/button';

export function Actions() {
  return (
    <div className="flex gap-3">
      <Button>Deposit</Button>
      <Button variant="secondary">Withdraw</Button>
      <Button className="rounded-md">Details</Button>
    </div>
  );
}
