const features = [{ title: 'Fast' }, { title: 'Safe' }, { title: 'Cheap' }];

export function Features() {
  return (
    <div className="grid grid-cols-3 gap-6">
      {features.map((f) => (
        <div key={f.title} className="rounded-2xl border bg-white p-6 shadow-lg">
          {f.title}
        </div>
      ))}
      <div className="rounded-2xl bg-white p-6 shadow-lg">More</div>
    </div>
  );
}
