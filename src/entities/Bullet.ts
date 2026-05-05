import { GameObject } from './GameObject.ts';
import { Enemy } from './Enemy.ts';
import { Renderer } from '../core/Renderer.ts';
import { Vector2D } from '../utils/Vector2D.ts';

const BULLET_RADIUS = 5;

export class Bullet extends GameObject {
  readonly radius = BULLET_RADIUS;

  damage = 0;
  speed = 0;

  private target: Enemy | null = null;
  private direction: Vector2D = Vector2D.zero();

  constructor() {
    super(0, 0);
    this.active = false; // starts pooled / inactive
  }

  /**
   * Reset state when acquired from the pool.
   * Sets the bullet active and aimed at the given target.
   */
  init(startPos: Vector2D, target: Enemy, damage: number, speed: number): void {
    this.position = startPos.clone();
    this.target = target;
    this.damage = damage;
    this.speed = speed;
    this.direction = target.pos.subtract(startPos).normalize();
    this.active = true;
  }

  update(deltaTime: number): void {
    if (!this.active) return;

    const step = this.speed * deltaTime;

    if (this.target !== null && this.target.isActive) {
      // Home in on live target
      const toTarget = this.target.pos.subtract(this.position);
      this.direction = toTarget.normalize();
    }
    // Move in current direction (straight line if target is gone)
    this.position = this.position.add(this.direction.scale(step));

    // Auto-release once bullet leaves the playfield
    if (
      this.position.x < -100 ||
      this.position.x > 900 ||
      this.position.y < -100 ||
      this.position.y > 700
    ) {
      this.active = false;
    }
  }

  draw(renderer: Renderer): void {
    if (!this.active) return;
    renderer.drawCircle(this.position, BULLET_RADIUS, '#2c1654', '#1a0a2e', 1);
  }
}
