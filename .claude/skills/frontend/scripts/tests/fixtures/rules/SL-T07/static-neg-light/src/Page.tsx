// A light page: mid-grey text on white passes 4.5:1, and a 40% foreground tint only fails on a dark ground.
export function Page() {
  return (
    <main className="bg-white">
      <p className="text-gray-600">Collateral ratio, updated each block</p>
      <span className="text-foreground/40">Hint</span>
    </main>
  );
}
