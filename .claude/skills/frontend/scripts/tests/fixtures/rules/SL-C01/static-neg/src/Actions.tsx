import { Button } from '@/components/ui/button';

export function Actions() {
  return (
    <div className="flex gap-3">
      <Button>Deposit</Button>
      <Button variant="secondary">Withdraw</Button>
      <button className="rounded-full p-2" aria-label="Close">
        ×
      </button>
      <button className="rounded-md px-3">Cancel</button>
    </div>
  );
}
