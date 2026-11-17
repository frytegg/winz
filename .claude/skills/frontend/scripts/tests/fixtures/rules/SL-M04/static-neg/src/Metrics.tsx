import { NumberTicker } from '@/components/magicui/number-ticker';

export function Metrics({ tvl, price }: { tvl: string; price: number }) {
  return (
    <dl data-source="testnet" data-as-of="2026-10-01T10:00:00Z">
      <dt>TVL</dt>
      <dd data-source="testnet">{tvl}</dd>
      <dt>Fee</dt>
      <dd data-ledger="C-012">0.3%</dd>
      <dt>Assets</dt>
      <dd data-ledger="C-013">12+</dd>
      <dt>Uptime</dt>
      <dd data-ledger="C-014">99.9%</dd>
      <NumberTicker value={price} />
    </dl>
  );
}

export const prices = ['$19', '$29/mo', 'v1.2.3', '2024'];
export const style = { width: '100%', height: '50%', left: '25%' };
