import type { PlacementSpot } from '../defs/mapDefs.ts';
import { type MapGrid, TILE_SIZE } from '../level/MapGrid.ts';
import { Vector2D } from '../utils/Vector2D.ts';
import type { Renderer } from './Renderer.ts';

export const HOLD_DURATION = 2.0; // seconds to hold pointer before placing
const DRAG_CANCEL_THRESHOLD = 8; // px — slide past this to cancel hold and drag instead

export interface InputCallbacks {
  /** 現在プレビュー中の建設スポット（なければ null）*/
  getPreviewSpot(): PlacementSpot | null;
  /** 所持ひび割れ卵数 */
  getCrackedEggs(): number;
  /** 卵配置フェーズ中か */
  isEggPlacing(): boolean;
  /** ウェーブ間インターバル中か */
  isInterWave(): boolean;
  /** プレイヤーがアタック中か */
  isPlayerAttacking(): boolean;
  /** アタックのクールダウンが残っているか */
  hasAttackCooldown(): boolean;

  /** 卵配置フェーズでゴールタイルをタップしたとき */
  onEggPlaced(col: number, row: number): void;
  /** 長押し完了で建設 */
  onBuildComplete(spot: PlacementSpot): void;
  /** プレイヤー移動ターゲット更新 */
  onPlayerMove(x: number, y: number): void;
  /** 最近傍の敵へアタック開始 */
  onAttack(): void;
}

export class InputHandler {
  /** ホールド中のスポット（Game が参照して描画プレビューに使う）*/
  holdSpot: PlacementSpot | null = null;
  holdTimer = 0;

  private dragPointerId: number | null = null;
  private dragStart: Vector2D | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly mapGrid: MapGrid;
  private readonly cb: InputCallbacks;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: Renderer,
    mapGrid: MapGrid,
    callbacks: InputCallbacks,
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.mapGrid = mapGrid;
    this.cb = callbacks;

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onUp);
  }

  /**
   * 毎フレーム呼び出す。長押しタイマーを進め、完了時に onBuildComplete を呼ぶ。
   * @returns 建設が完了したかどうか
   */
  update(deltaTime: number): boolean {
    if (this.holdSpot === null) return false;
    this.holdTimer += deltaTime;
    if (this.holdTimer >= HOLD_DURATION) {
      const spot = this.holdSpot;
      this.holdSpot = null;
      this.holdTimer = 0;
      this.cb.onBuildComplete(spot);
      return true;
    }
    return false;
  }

  reset(): void {
    if (this.dragPointerId !== null) {
      try {
        this.canvas.releasePointerCapture(this.dragPointerId);
      } catch {
        /* already released */
      }
    }
    this.holdSpot = null;
    this.holdTimer = 0;
    this.dragPointerId = null;
    this.dragStart = null;
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onUp);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private pointerToCanvas(e: PointerEvent): Vector2D {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.renderer.width / (rect.width || 1);
    const scaleY = this.renderer.height / (rect.height || 1);
    return new Vector2D(
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top) * scaleY,
    );
  }

  private clampToCanvas(v: Vector2D): Vector2D {
    // Player.hitRadius = 34; here we use the same constant value
    const r = 34 * 0.6;
    const x = Math.max(r, Math.min(this.renderer.width - r, v.x));
    const y = Math.max(r, Math.min(this.renderer.height - r, v.y));
    return new Vector2D(x, y);
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private onDown = (e: PointerEvent): void => {
    const canvasPt = this.pointerToCanvas(e);

    // 卵配置フェーズ: ゴールタイルをタップするだけ
    if (this.cb.isEggPlacing()) {
      const { col, row } = this.mapGrid.pixelToGrid(canvasPt);
      this.cb.onEggPlaced(col, row);
      return;
    }

    this.dragPointerId = e.pointerId;
    this.dragStart = canvasPt.clone();
    this.canvas.setPointerCapture?.(e.pointerId);

    // プレビュースポットの範囲内を押したら長押しビルド開始
    const previewSpot = this.cb.getPreviewSpot();
    if (previewSpot && this.cb.getCrackedEggs() >= 1) {
      const center = this.mapGrid.spotCenter(previewSpot.col, previewSpot.row);
      const dx = Math.abs(canvasPt.x - center.x);
      const dy = Math.abs(canvasPt.y - center.y);
      if (dx <= TILE_SIZE && dy <= TILE_SIZE) {
        this.holdSpot = previewSpot;
        this.holdTimer = 0;
        return;
      }
    }

    // ウェーブ中かつクールダウンなしなら敵へアタック
    if (
      !this.cb.isInterWave() &&
      !this.cb.hasAttackCooldown() &&
      !this.cb.isPlayerAttacking()
    ) {
      this.cb.onAttack();
      return;
    }

    this.cb.onPlayerMove(canvasPt.x, canvasPt.y);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragPointerId !== e.pointerId) return;
    const pt = this.clampToCanvas(this.pointerToCanvas(e));

    // スライドがキャンセル閾値を超えたらホールドを中断してドラッグに切り替え
    if (this.holdSpot && this.dragStart) {
      const dx = pt.x - this.dragStart.x;
      const dy = pt.y - this.dragStart.y;
      if (dx * dx + dy * dy > DRAG_CANCEL_THRESHOLD * DRAG_CANCEL_THRESHOLD) {
        this.holdSpot = null;
        this.holdTimer = 0;
      }
    }

    if (!this.holdSpot && !this.cb.isPlayerAttacking()) {
      this.cb.onPlayerMove(pt.x, pt.y);
    }
  };

  private onUp = (e?: PointerEvent): void => {
    if (e && this.dragPointerId === e.pointerId) {
      this.canvas.releasePointerCapture?.(e.pointerId);
    }
    this.dragPointerId = null;
    this.dragStart = null;
    this.holdSpot = null;
    this.holdTimer = 0;
  };
}
