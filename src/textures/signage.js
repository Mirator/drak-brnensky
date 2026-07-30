/**
 * Czech shopfront signage — drawn straight into the sign band of a
 * 'shopfront' facade bay with the canvas 2D text API. No image assets.
 */
export const CZECH_SIGNS = [
  'LÉKÁRNA', 'PEKÁRNA', 'TRAFIKA', 'HOSPODA', 'KNIHY', 'POTRAVINY',
  'KAVÁRNA', 'ŘEZNICTVÍ', 'CUKRÁRNA', 'HODINÁŘSTVÍ', 'KVĚTINY', 'VINOTÉKA',
];

/** Draw `text` centred in the given band, scaled to fit. */
export function drawSign(ctx, text, x, y, w, h) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = h * 0.62;
  ctx.font = `bold ${size}px sans-serif`;
  while (ctx.measureText(text).width > w * 0.92 && size > 4) {
    size -= 1;
    ctx.font = `bold ${size}px sans-serif`;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, x + w / 2 + 1, y + h / 2 + 1);
  ctx.fillStyle = '#f2e6c8';
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.restore();
}
