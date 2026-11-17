const testimonials = [
  { name: 'Sarah Chen', role: 'CTO', quote: 'This changed how we ship.', avatar: 'https://i.pravatar.cc/150?img=1' },
  { name: 'Marcus Lee', role: 'Founder', quote: 'Best decision we made.' },
];

export function Social() {
  return (
    <section>
      <p>Trusted by</p>
      <div className="flex gap-8">
        <img src="/logos/a.svg" alt="" />
        <img src="/logos/b.svg" alt="" />
        <img src="/logos/c.svg" alt="" />
      </div>
      {testimonials.map((t) => (
        <blockquote key={t.name}>{t.quote}</blockquote>
      ))}
    </section>
  );
}
