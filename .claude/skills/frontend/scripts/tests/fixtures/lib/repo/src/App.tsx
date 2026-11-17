import { useState } from "react";
// linear-gradient in a line comment
type Pair = <T>(x: T) => [T, T];
export function App(): JSX.Element {
  const [n] = useState<number>(0); /* linear-gradient in a block comment */
  return (
    <main style={{ background: "linear-gradient(90deg, #7c3aed, #2563eb)" }}>
      {/* linear-gradient in a JSX comment */}
      <p>Don't visit https://example.com // not a comment</p>
      <span>{n}</span>
    </main>
  );
}
