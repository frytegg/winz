import { useEffect, useRef } from 'react';

// An infinite-scroll sentinel loads more rows; nothing is hidden at rest.
export function Feed({ loadMore }: { loadMore: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore();
    });
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loadMore]);
  return <div ref={sentinel} />;
}
