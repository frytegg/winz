import { copy } from "@/lib/copy";

/** Scaffold landing. Replaced by screen M0 (task U-02). */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-5xl font-bold lowercase tracking-tight text-lime">{copy.brand.name}</h1>
      <p className="text-lg text-muted">{copy.brand.tagline}</p>
    </main>
  );
}
