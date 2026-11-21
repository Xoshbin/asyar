// Inspired by canvas-confetti (https://github.com/catdad/canvas-confetti)

const COLORS = ['#ff5f6d', '#ffb347', '#ffe066', '#5ee08f', '#4dabf7', '#9775fa', '#f783ac'];

export const BURST_MS = 4000;

export interface Piece {
  x: number;
  y: number;
  angle: number;
  velocity: number;
  gravity: number;
  drift: number;
  wobble: number;
  wobbleSpeed: number;
  tilt: number;
  size: number;
  color: string;
  round: boolean;
}

/** One cannon shot from (x, y) aimed at `angleDeg` (0 = right, 90 = up). */
export function fire(
  x: number,
  y: number,
  angleDeg: number,
  count: number,
  width: number,
  height: number,
  scale: number,
): Piece[] {
  const spread = (55 * Math.PI) / 180;
  const speed = height * 0.055;
  return Array.from({ length: count }, () => ({
    x,
    y,
    angle: (-angleDeg * Math.PI) / 180 + (Math.random() - 0.5) * spread,
    velocity: speed * (0.5 + Math.random()),
    gravity: height * 0.0035,
    drift: (Math.random() - 0.5) * width * 0.0008,
    wobble: Math.random() * 10,
    wobbleSpeed: 0.05 + Math.random() * 0.05,
    tilt: Math.random() * Math.PI,
    size: (6 + Math.random() * 6) * scale,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() < 0.3,
  }));
}

/** Advances a piece by `dt` frames (1 = one 60 Hz frame). */
export function step(p: Piece, dt: number): void {
  p.x += (Math.cos(p.angle) * p.velocity + p.drift) * dt;
  p.y += (Math.sin(p.angle) * p.velocity + p.gravity) * dt;
  p.velocity *= Math.pow(0.92, dt);
  p.wobble += p.wobbleSpeed * dt;
  p.tilt += 0.1 * dt;
}

export function draw(ctx: CanvasRenderingContext2D, p: Piece): void {
  const wx = p.x + p.size * Math.cos(p.wobble);
  const wy = p.y + p.size * Math.sin(p.wobble);
  const tx = (Math.random() + 2) * Math.cos(p.tilt);
  const ty = (Math.random() + 2) * Math.sin(p.tilt);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  if (p.round) {
    const rx = Math.abs(wx - p.x) * 0.6 + 1;
    const ry = Math.abs(wy - p.y) * 0.6 + 1;
    ctx.ellipse(p.x, p.y, rx, ry, p.tilt, 0, Math.PI * 2);
  } else {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(wx, p.y + ty);
    ctx.lineTo(wx + tx, wy + ty);
    ctx.lineTo(p.x + tx, wy);
  }
  ctx.closePath();
  ctx.fill();
}
