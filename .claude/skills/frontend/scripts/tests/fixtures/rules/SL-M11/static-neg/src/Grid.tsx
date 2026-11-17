export function Grid() {
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div>Alpha</div>
        <div>Beta</div>
        <div>Gamma</div>
      </div>
      <div className="grid grid-cols-3">
        <div className="col-span-2">Chart</div>
        <div className="col-span-1">Side panel</div>
      </div>
    </>
  );
}
