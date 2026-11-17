// FD14-F13, FD03-F21: hovers that rise, darken, move or tint a ghost button are real feedback.
export function App() {
  return (
    <main>
      <button className="rounded-md bg-violet-600 px-4 py-2 text-white hover:bg-violet-700">Deposit</button>
      <button className="opacity-60 hover:opacity-100">Show more</button>
      <button className="rounded-md px-3 py-2 hover:bg-accent/50">Ghost</button>
      <a href="/docs" className="bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-px">Docs</a>
      <div className="overflow-hidden rounded-lg hover:opacity-90"><img src="/shot.png" alt="Dashboard" /></div>
      <button className="btn" type="button">Withdraw</button>
      {/* <button className="bg-violet-600 hover:opacity-80">old</button> */}
    </main>
  );
}
