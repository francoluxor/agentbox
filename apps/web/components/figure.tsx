import type { ReactNode } from 'react';

// Figure with an optional screenshot. With no `src` it renders a dashed
// placeholder + caption — drop a real image in later by adding `src`.
export function Figure({
  src,
  alt,
  caption,
}: {
  src?: string;
  alt?: string;
  caption?: ReactNode;
}) {
  return (
    <figure className="agb-figure">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ''} />
      ) : (
        <div className="agb-figure-ph" aria-hidden>
          <span>screenshot placeholder</span>
        </div>
      )}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
