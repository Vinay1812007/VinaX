import { useEffect, useRef } from 'react';

interface Props {
  onVisible: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/** Invisible scroll sentinel — triggers `onVisible` to load the next page. */
export function InfiniteSentinel({ onVisible, disabled, loading }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onVisible);
  cbRef.current = onVisible;

  useEffect(() => {
    if (disabled || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cbRef.current();
      },
      { rootMargin: '600px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [disabled]);

  return (
    <div ref={ref} className="h-12 flex items-center justify-center">
      {loading && (
        <span className="w-5 h-5 border-2 border-ember-500 border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  );
}
