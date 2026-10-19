import React from 'react';
// Shown for shots whose view is not built yet (technical sample only; build refuses it in production).
export function Placeholder({shot}) {
  return <div className="placeholder" data-skill-placeholder="true"><b>{shot.id}</b><span>{shot.headline}</span></div>;
}
