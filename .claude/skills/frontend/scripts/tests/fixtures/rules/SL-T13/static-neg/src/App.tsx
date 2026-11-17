import { PriceChart } from './PriceChart';
import { IdleCursor } from './IdleCursor';
import { FloatingLines } from './FloatingLines';
import { Tiles } from './Tiles';

export function App() {
  return (
    <main>
      <PriceChart />
      <IdleCursor />
      <FloatingLines interactive={false} />
      <Tiles />
    </main>
  );
}
