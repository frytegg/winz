export function Glow() {
  return (
    <section
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
      }}
      className="bg-[radial-gradient(600px_at_var(--mouse-x)_var(--mouse-y),rgba(124,58,237,0.15),transparent)]"
    >
      <h2>Settle in one block</h2>
    </section>
  );
}
