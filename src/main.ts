import './style.css';
import { Game } from './core/Game.ts';
import { TILE_SIZE, GRID_OFFSET_Y } from './level/MapGrid.ts';

const COLS = 8;
const ROWS = 13;
const CANVAS_W = COLS * TILE_SIZE;              // 400
const CANVAS_H = ROWS * TILE_SIZE + GRID_OFFSET_Y; // 700

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
    if (game.isWaveClear) {
      btnStartWave.textContent = 'NEXT WAVE';
      btnStartWave.disabled    = false;
      btnStartWave.classList.add('next-wave');
    } else {
      btnStartWave.textContent = '▶';
      btnStartWave.disabled    = !game.isInterWave || game.isPaused || game.isGameClear || game.isEggPlacing;
      btnStartWave.classList.remove('next-wave');
    }
  }

  if (btnPause) {
    btnPause.textContent = game.isPaused ? '▶' : '⏸';
    btnPause.classList.toggle('active', game.isPaused);
  }

  requestAnimationFrame(syncUI);
}

requestAnimationFrame(syncUI);
