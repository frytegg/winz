// FD03-F31: Emil Kowalski's blog sets prose emphasis in serif italic; display text only counts.
export function Post() {
  return (
    <article className="prose">
      <h1 className="text-5xl">Notes on <i className="fa-solid fa-bolt" /> fast settlement</h1>
      <h1>Collateral ratio <span className="text-zinc-500">(live)</span></h1>
      <h1>
        Escrow <span className="bg-gradient-to-r from-sky-400 to-emerald-400 bg-clip-text text-transparent">settles</span>
      </h1>
      <h2>Rates <span className="text-emerald-600">up</span> today</h2>
      <p>The script releases funds <em>only</em> once the carrier signs.</p>
      <blockquote className="font-serif italic">A quoted line from the arbiter.</blockquote>
      {/* <h1>Credit, <em className="font-serif">priced</em></h1> */}
    </article>
  );
}
