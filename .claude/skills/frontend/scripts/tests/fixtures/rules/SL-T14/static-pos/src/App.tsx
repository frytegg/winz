import { Button } from '@/components/ui/button';

export function App() {
  return (
    <main>
      <Button>Open the app</Button>
      <a href="/docs" className="rounded-md bg-violet-600 px-4 py-2 text-white transition-opacity hover:opacity-80">Read the docs</a>
      <button className="btn" type="button">Deposit</button>
    </main>
  );
}
