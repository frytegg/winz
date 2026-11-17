// TODO: move the validation into a hook
export function Form() {
  const acmeTheme = 'light';
  return (
    <form data-theme={acmeTheme}>
      <label htmlFor="email">Email</label>
      <input id="email" placeholder="you@example.com" />
      <label htmlFor="name">Name</label>
      <input id="name" placeholder="Jane Doe" />
    </form>
  );
}
