import type { Renderer } from '../core/Renderer.ts';
import { Vector2D } from '../utils/Vector2D.ts';

export abstract class GameObject {
  protected position: Vector2D;
  protected active: boolean = true;

  constructor(x: number, y: number) {
    this.position = new Vector2D(x, y);
  }

  abstract update(deltaTime: number): void;
  abstract draw(renderer: Renderer): void;

  get pos(): Vector2D {
    return this.position;
  }

  get isActive(): boolean {
    return this.active;
  }

  destroy(): void {
    this.active = false;
  }
}
