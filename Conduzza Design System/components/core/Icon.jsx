import React from 'react';

const BASE = 'https://unpkg.com/lucide-static@0.544.0/icons/';
const CACHE = new Map();   // name -> svg markup string
const INFLIGHT = new Map();

function load(name) {
  if (CACHE.has(name)) return null;
  if (!INFLIGHT.has(name)) {
    INFLIGHT.set(name, fetch(BASE + name + '.svg')
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => { CACHE.set(name, t); return t; })
      .catch(() => { CACHE.set(name, ''); return ''; }));
  }
  return INFLIGHT.get(name);
}

/**
 * Lucide glyph, inlined as real SVG so it inherits currentColor and survives
 * rasterisation (html-to-image, PNG/PDF export). Fetched once per name, cached.
 */
export function Icon({ name = 'circle', size = 18, color = 'currentColor', style, className, title, ...rest }) {
  const [, tick] = React.useReducer((n) => n + 1, 0);
  const markup = CACHE.get(name);
  React.useEffect(() => {
    if (CACHE.has(name)) return;
    let alive = true;
    const p = load(name);
    if (p) p.then(() => { if (alive) tick(); });
    return () => { alive = false; };
  }, [name]);

  const base = {
    display: 'inline-flex', flex: '0 0 auto', alignItems: 'center', justifyContent: 'center',
    width: size, height: size, color, lineHeight: 0, ...style,
  };
  if (!markup) return <span role="presentation" className={className} style={base} {...rest} />;
  const sized = markup
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`);
  return (
    <span
      role={title ? 'img' : 'presentation'} aria-label={title} className={className}
      style={base} dangerouslySetInnerHTML={{ __html: sized }} {...rest}
    />
  );
}
