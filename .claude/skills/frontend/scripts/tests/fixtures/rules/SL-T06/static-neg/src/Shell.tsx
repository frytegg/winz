export function Shell({ open }: { open: boolean }) {
  return (
    <div>
      <nav className="sticky top-0 z-50 w-full border-b bg-background/70 backdrop-blur">Menu</nav>
      <header className="bg-black/40 backdrop-blur-sm">Vaultline</header>
      {open && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />}
      {/* <div className="rounded-2xl bg-white/10 backdrop-blur-md">old glass</div> */}
      {/* ETHDenver's case: blur under an opaque fill shows nothing through. */}
      <div className="rounded-xl bg-zinc-900 p-6 backdrop-blur-lg">
        <h3>Solid card</h3>
      </div>
      <div className="rounded-xl bg-white/10 p-6 backdrop-blur-none">No blur</div>
    </div>
  );
}
