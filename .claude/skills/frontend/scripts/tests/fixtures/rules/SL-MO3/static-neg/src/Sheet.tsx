import { toast } from 'sonner';

export function Sheet() {
  const notify = () => toast('Saved', { duration: 5000 });
  return (
    <div>
      <div className="fixed inset-y-0 right-0 h-full transition ease-in-out data-[state=open]:duration-500 data-[state=closed]:duration-300 data-[state=open]:slide-in-from-right">
        Sheet
      </div>
      <span className="animate-spin duration-1000">Loading</span>
      <button className="transition-colors duration-150" onClick={notify}>
        Save
      </button>
    </div>
  );
}
