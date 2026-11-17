export function Buttons() {
  return (
    <div className="flex gap-3">
      <button className="rounded-full bg-black px-6 py-2 text-white">Deposit</button>
      <button className="rounded-full border px-6 py-2">Withdraw</button>
      <a href="/app" className="rounded-full bg-indigo-600 px-5 py-2 text-white">
        Launch
      </a>
      <button className="rounded-md px-3 py-1">Cancel</button>
    </div>
  );
}
