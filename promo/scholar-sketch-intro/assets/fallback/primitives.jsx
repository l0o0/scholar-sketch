// Adapted from CodePilot, © 2025–2026 op7418. See LICENSE.CodePilot and SOURCE.md.
import React from 'react';
const classes = (...parts) => parts.filter(Boolean).join(' ');
export function CardFrame({className, children, ...props}) {
  return <div {...props} className={classes('film-card-frame', className)}>{children}</div>;
}
export function CardSurface({className, children, ...props}) {
  return <div {...props} className={classes('film-card-surface', className)}>{children}</div>;
}
export function FilmButton({variant = 'default', className, children, ...props}) {
  return <button type="button" {...props} data-variant={variant} className={classes('film-button', className)}>{children}</button>;
}
export function FilmBadge({className, children, ...props}) {
  return <span {...props} className={classes('film-badge', className)}>{children}</span>;
}
