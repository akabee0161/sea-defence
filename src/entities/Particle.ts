import { GameObject } from './GameObject.ts';
import { Renderer } from '../core/Renderer.ts';
import { Vector2D } from '../utils/Vector2D.ts';

const FRICTION    = 0.95;  // velocity multiplier per 60 Hz tick
const BASE_SPEED  = 60;    // px/s minimum initial speed
const SPEED_RANGE = 120;   // px/s additional random range
const BASE_LIFE   = 0.4;   // seconds minimum lifetime
const LIFE_RANGE  = 0.6;   // seconds additional random range
const BASE_SIZE   = 2;     // px radius minimum
const SIZE_RANGE  = 4;     // px additional random range

export class Particle extends GameObject {
  vx      = 0;
  vy      = 0;
  life    = 0;
  maxLife = 0;
  color   = '#ffffff';
  size    = 0;

  constructor() {
    super(0, 0);
    this.active = false; // starts pooled/inactive
  }

  init(x: number, y: number, color: string): void {
    this.position = new Vector2D(x, y);
    const angle   = Math.random() * Math.PI * 2;
    const speed   = BASE_SPEED + Math.random() * SPEED_RANGE;
    this.vx       = Math.cos(angle) * speed;
    this.vy       = Math.sin(angle) * speed;
    this.maxLife  = BASE_LIFE + Math.random() * LIFE_RANGE;
    this.life     = this.maxLife;
    this.color    = color;
    this.size     = BASE_SIZE + Math.random() * SIZE_RANGE;
    this.active   = true;
  }

  update(deltaTime: number): void {
    if (!this.active) return;
    this.position = this.position.add(new Vector2D(this.vx * deltaTime, this.vy * deltaTime));
    this.vx *= FRICTION;
    this.vy *= FRICTION;
    this.life -= deltaTime;
    if (this.life <= 0) this.destroy();
  }

  draw(renderer: Renderer): void {
    if (!this.active) return;
    const alpha = Math.max(0, this.life / this.maxLife);
    const r     = Math.max(0.5, this.size * alpha);
    const ctx   = renderer.context;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.position.x, this.position.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
