export function DeviceStep({ state }) {
  const step = state.intermediateValue?.requiredUserInteraction;
  return <p data-rec-role="key">{step === 'sign-transaction' ? 'Approve the transfer on your Ledger' : 'Unlock your Ledger'}</p>;
}
