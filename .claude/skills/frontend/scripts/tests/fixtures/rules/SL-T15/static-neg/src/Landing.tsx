// FD10-F27: clamp() fluid spacing, optical 1-2px nudges and on-scale arbitrary values are deliberate.
export function Landing() {
  return (
    <main>
      <section className="py-24">Hero</section>
      <section className="py-24">Features</section>
      <section className="py-16">Proof</section>
      <section className="py-24">Pricing</section>
      <div className="mt-[clamp(1rem,4vw,3rem)] p-[24px] pt-[2px] gap-[1.5rem] -mt-[1px]">Cards</div>
      {/* <div className="p-[13px]">old</div> */}
    </main>
  );
}
