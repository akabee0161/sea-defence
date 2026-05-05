export class Vector2D {
  constructor(
    public x: number,
    public y: number,
  ) {}

  add(other: Vector2D): Vector2D {
    return new Vector2D(this.x + other.x, this.y + other.y);
  }

  subtract(other: Vector2D): Vector2D {
    return new Vector2D(this.x - other.x, this.y - other.y);
  }

  scale(factor: number): Vector2D {
    return new Vector2D(this.x * factor, this.y * factor);
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  normalize(): Vector2D {
    const mag = this.magnitude();
    if (mag === 0) return new Vector2D(0, 0);
    return new Vector2D(this.x / mag, this.y / mag);
  }

  distanceTo(other: Vector2D): number {
    return this.subtract(other).magnitude();
  }

  clone(): Vector2D {
    return new Vector2D(this.x, this.y);
  }

  static zero(): Vector2D {
    return new Vector2D(0, 0);
  }
}
