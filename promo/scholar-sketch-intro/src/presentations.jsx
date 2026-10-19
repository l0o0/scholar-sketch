import React from 'react';
import {CardFrame, CardSurface, FilmButton, FilmBadge} from '../assets/fallback/primitives.jsx';
// Technical fixture using the adapted fallback primitives, not product business components.
export function FeatureVisual() {
  return <CardFrame data-skill-placeholder="true"><CardSurface style={{padding:54}}>
    <FilmBadge>组件展示 / DEMO</FilmBadge>
    <h2>组件可以直接接进来。</h2>
    <p>把真实产品组件接进来，再安排选中、展开和切换。</p>
    <div style={{display:'flex',gap:16,marginTop:42,fontSize:26}}>
      <FilmButton>主要操作</FilmButton><FilmButton variant="secondary">次要操作</FilmButton>
    </div>
  </CardSurface></CardFrame>;
}
