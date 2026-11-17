import { Feed } from './Feed';
import { Intro } from './Intro';
import { DialogContent } from './components/ui/dialog';

export function App() {
  return (
    <main>
      <Intro />
      <Feed />
      <DialogContent />
    </main>
  );
}
