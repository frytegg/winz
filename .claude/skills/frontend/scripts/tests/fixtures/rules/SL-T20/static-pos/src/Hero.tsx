export function Hero() {
  return (
    <section className="relative bg-gradient-to-br from-violet-600 to-fuchsia-500">
      <svg className="absolute inset-0 h-full w-full opacity-30" aria-hidden="true">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <h1>Credit, priced in one block</h1>
    </section>
  );
}
