export function Footer() {
  const copy = () => {
    navigator.clipboard.writeText('addr_test1...');
    alert('Copied');
  };
  return (
    <footer>
      <p>Powered by Cardano preprod</p>
      <button onClick={copy}>Copy address</button>
    </footer>
  );
}
