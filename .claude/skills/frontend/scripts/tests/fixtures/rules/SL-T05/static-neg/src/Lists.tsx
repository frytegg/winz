export function Lists() {
  return (
    <div>
      <span className="rounded-full border-l-4 border-emerald-500 px-2 text-xs">Lending</span>
      <div className="border-l-4 border-gray-300 pl-4">A neutral rule beside a paragraph.</div>
      <div className="border-l-4 border-border pl-4">A token rule in the neutral family.</div>
      <div className="p-4 hover:border-l-4 hover:border-blue-500">Hover state only</div>
      <ol>
        <li className="border-l-2 border-blue-500 pl-3">Step on a timeline rail</li>
      </ol>
      <blockquote className="border-l-4 border-indigo-500 pl-4">A quoted line.</blockquote>
      <table>
        <tbody>
          <tr className="is-late"><td>late</td></tr>
        </tbody>
      </table>
      <div className="toast-error">Rejected</div>
      <div className="tab" aria-selected="true">Overview</div>
      <div className="card rail">Card</div>
    </div>
  );
}
