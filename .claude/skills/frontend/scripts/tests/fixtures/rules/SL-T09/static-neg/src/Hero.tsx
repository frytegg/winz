// FD10-F26: a status linked to its proof is checkable, and breadcrumbs are navigation.
export function Hero() {
  return (
    <section>
      <a href="https://preprod.cardanoscan.io/transaction/4f2a" className="rounded-full border px-3 py-1 text-sm">Testnet contract</a>
      <h1>Escrow that settles on delivery</h1>
    </section>
  );
}

export function Proofed() {
  return (
    <section>
      <span data-proof="C-012" className="rounded-full border px-3 py-1 text-sm">Audited by two firms</span>
      <h1>Audited vaults</h1>
    </section>
  );
}

export function Docs() {
  return (
    <article>
      <nav aria-label="breadcrumb">
        <ol className="flex gap-2 text-xs uppercase tracking-wide"><li>Docs</li><li>Vaults</li></ol>
      </nav>
      <h1>Vault parameters</h1>
    </article>
  );
}

export function Profile() {
  return (
    <section>
      <img className="h-16 w-16 rounded-full px-2 py-1" src="/avatar.png" alt="" />
      {/* <span className="rounded-full border px-3 py-1">New</span> */}
      <h1>Account</h1>
    </section>
  );
}

export function Far() {
  return (
    <section>
      <span className="rounded-full border px-3 py-1 text-sm">Changelog</span>
      <p>One</p>
      <p>Two</p>
      <p>Three</p>
      <p>Four</p>
      <p>Five</p>
      <p>Six</p>
      <p>Seven</p>
      <p>Eight</p>
      <p>Nine</p>
      <p>Ten</p>
      <h1>Far below</h1>
    </section>
  );
}
