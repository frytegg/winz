export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="min-h-screen">{children}</main>
      <section className="py-24">
        <h1>Settle invoices on Cardano</h1>
      </section>
    </div>
  );
}
