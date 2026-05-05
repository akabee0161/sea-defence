import './style.css';
import { Game } from './core/Game.ts';
import { TILE_SIZE } from './level/MapGrid.ts';

const COLS = 16;
const ROWS = 12;
const CANVAS_W = COLS * TILE_SIZE; // 800
const CANVAS_H = ROWS * TILE_SIZE; // 600

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas element #game-canvas not found');

canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

const game = new Game(canvas);
game.start();

// ── DOM refs ─────────────────────────────────────────────────────────────────

const btnStartWave = document.getElementById('btn-start-wave') as HTMLButtonElement | null;
const btnPause     = document.getElementById('btn-pause')      as HTMLButtonElement | null;
const btnRestart   = document.getElementById('btn-restart')    as HTMLButtonElement | null;

// ── Button wiring ─────────────────────────────────────────────────────────────

btnStartWave?.addEventListener('click', () => { game.startNextWave(); });
btnPause?.addEventListener('click',     () => { game.togglePause(); });
btnRestart?.addEventListener('click',   () => { game.restart(); });

// ── UI sync loop (rAF — keeps button states fresh) ────────────────────────────

function syncUI(): void {
  if (btnStartWave) {
    btnStartWave.disabled = !game.isInterWave || game.isPaused || game.isGameClear || game.isEggPlacing;
  }

  if (btnPause) {
    btnPause.textContent = game.isPaused ? '▶' : '⏸';
    btnPause.classList.toggle('active', game.isPaused);
  }

  requestAnimationFrame(syncUI);
}

requestAnimationFrame(syncUI);
