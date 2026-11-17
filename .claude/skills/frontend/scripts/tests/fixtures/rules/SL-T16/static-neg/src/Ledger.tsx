// Comments are not copy — an em dash here never counts — nor here.
export const PAGE_TITLE = 'Vaultline — Escrow on Cardano';

export function Ledger({ rows }: { rows: Array<{ id: string; fee?: string }> }) {
  return (
    <article>
      <h2>Why escrow on Cardano</h2>
      <p>
        Most marketplaces hold the buyer's money for days before the seller sees any of it, and when a dispute opens,
        both sides wait on a support queue that answers in its own time. Vaultline moves that money into a script that
        anyone can read, so the rules are the same for every order and the release condition is checked by the ledger,
        not by a person on a shift.
      </p>
      <p>
        A buyer locks the price in the escrow script when the order is placed. The seller ships, the carrier scans the
        parcel at delivery, and an oracle signs that scan. The script releases the funds once it sees the signature: no
        ticket, no email thread, no waiting for a manager to approve the refund or the payout.
      </p>
      <p>
        If the parcel never arrives, the buyer reclaims the deposit after the deadline written into the order. If it
        arrives damaged, either side can open a dispute, which freezes the funds until two of three named arbiters sign
        a split. Every step leaves a transaction on chain, so the history of an order is a list of hashes you can check
        yourself on any explorer, today or in five years.
      </p>
      <p>
        We built this for small sellers who lose a week of cash flow on every sale and for buyers who have been told that
        a refund is on its way for a month. The fees are fixed at one percent of the order, paid when the funds move, and
        the script is the same one we run for our own shop. There is no private version with better terms for anyone.
      </p>
      <p>
        The code is open, the oracle keys are listed on this page, and the arbiters publish their decisions with the
        evidence they read. If you find a way to release funds without the right signatures, the bounty is the full value
        of the largest open order on the day you report it, paid from our own treasury.
      </p>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.id}</td><td>{r.fee ?? '—'}</td><td>Fee · —</td><td>—/2 signatures</td></tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
