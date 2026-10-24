import { Chess } from 'chess.js';
import { SAVE_KEY, claimDraw, claimableDrawReasons, createGame, createOperaReplay, gameOutcome, intendedMoveClaim, offerDraw, restoreGame, serializeGame } from './chess-state.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const glyphs = { w: { k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙' }, b: { k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟' } };
const files = 'abcdefgh';
const board = $('board');
const replayBoard = $('replay-board');
let game = new Chess();
let replay = createOperaReplay();
let replayIndex = 0;
let replayTimer = null;
let selected = null;
let focusSquare = 'e2';
let mode = 'game';
let outcome = null;
let pendingDrawOffer = null;
let pendingClaimIntent = null;
let pendingCurrentClaimReasons = null;
let recoveryBlocked = false;
let storageWritable = true;

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}
const storage = safeStorage();

function loadSavedGame() {
  if (!storage) { storageWritable = false; $('save-state').textContent = 'This game will not be saved'; return; }
  let raw;
  try { raw = storage.getItem(SAVE_KEY); } catch { storageWritable = false; $('save-state').textContent = 'This game will not be saved'; return; }
  if (!raw) return;
  try {
    game = restoreGame(raw); outcome = game.savedOutcome ?? gameOutcome(game); pendingDrawOffer = game.savedDrawOffer;
    if (game.savedVersion === 1) persist();
  }
  catch (error) {
    recoveryBlocked = true;
    $('recovery-message').textContent = `${error.message} The saved data has been kept unchanged. Start a fresh game to continue.`;
    $('recovery-dialog').showModal();
  }
}

function persist() {
  if (!storage || !storageWritable) return;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(serializeGame(game, outcome, pendingDrawOffer)));
    $('save-state').textContent = 'Saved on this device';
  } catch {
    storageWritable = false;
    $('save-state').textContent = 'Reload recovery unavailable';
    announce('This game is still playable, but your browser could not save it for reload.');
  }
}

function announce(message) { $('announcer').textContent = ''; requestAnimationFrame(() => { $('announcer').textContent = message; }); }
function turnName(turn) { return turn === 'w' ? 'White' : 'Black'; }
function drawReasonName(reason) { return reason === 'threefold' ? 'threefold repetition' : reason === 'fifty-move' ? 'the fifty-move rule' : reason; }
function drawReasonsText(reasons) { return reasons.map(drawReasonName).join(' and '); }
function squaresFor(chess) {
  const output = [];
  for (let rank = 8; rank >= 1; rank--) for (const file of files) output.push(`${file}${rank}`);
  return output;
}
function legalFrom(chess, square) { return chess.moves({ square, verbose: true }).map((move) => move.to); }

function renderBoard(target, chess, interactive, index = 0) {
  target.replaceChildren();
  const legal = interactive && selected ? legalFrom(chess, selected) : [];
  const last = chess.history({ verbose: true }).at(-1);
  for (const square of squaresFor(chess)) {
    if (files.indexOf(square[0]) === 0) {
      const row = document.createElement('div'); row.setAttribute('role', 'row'); row.className = 'board-row'; target.append(row);
    }
    const piece = chess.get(square);
    const cell = document.createElement('button');
    cell.type = 'button'; cell.setAttribute('role', 'gridcell'); cell.dataset.square = square;
    const light = (files.indexOf(square[0]) + Number(square[1])) % 2 === 0;
    cell.className = `square ${light ? 'light' : 'dark'}`;
    if (piece) { const glyph = document.createElement('span'); glyph.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`; glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = glyphs[piece.color][piece.type]; cell.append(glyph); }
    if (square[1] === '1') { const fileMark = document.createElement('span'); fileMark.className = 'coord file-coord'; fileMark.setAttribute('aria-hidden','true'); fileMark.textContent = square[0]; cell.append(fileMark); }
    if (square[0] === 'a') { const rankMark = document.createElement('span'); rankMark.className = 'coord rank-coord'; rankMark.setAttribute('aria-hidden','true'); rankMark.textContent = square[1]; cell.append(rankMark); }
    if (interactive && square === selected) cell.classList.add('selected');
    if (legal.includes(square)) { cell.classList.add('legal-target'); if (piece) cell.classList.add('capture-target'); }
    const isLastOrigin = last?.from === square;
    const isLastDestination = last?.to === square;
    if (isLastOrigin || isLastDestination) cell.classList.add('last-move', isLastOrigin ? 'last-move-origin' : 'last-move-destination');
    if (interactive && chess.isCheck() && piece?.type === 'k' && piece.color === chess.turn()) cell.classList.add('in-check');
    const squareLabel = `${square[0].toUpperCase()}${square[1]}`;
    const endpointRole = isLastOrigin ? ', last move origin' : isLastDestination ? ', last move destination' : '';
    cell.setAttribute('aria-label', `${piece ? `${turnName(piece.color)} ${piece.type === 'n' ? 'knight' : ({ k:'king',q:'queen',r:'rook',b:'bishop',p:'pawn' }[piece.type])}` : 'Empty'}, ${squareLabel}${endpointRole}${interactive && legal.includes(square) ? ', legal destination' : ''}${interactive && square === selected ? ', selected' : ''}`);
    cell.tabIndex = square === (target === replayBoard ? 'e4' : focusSquare) ? 0 : -1;
    if (interactive) cell.addEventListener('click', () => onSquare(square));
    cell.addEventListener('keydown', (event) => onBoardKey(event, square, interactive));
    target.lastElementChild.append(cell);
  }
  target.setAttribute('aria-label', `${interactive ? 'Chessboard' : 'Opera Game board'}, ${turnName(chess.turn())} to move${chess.isCheck() ? ', in check' : ''}${index ? `, move ${Math.ceil(index / 2)}` : ''}`);
}

function onBoardKey(event, square, interactive) {
  const directions = { ArrowUp:[0,1], ArrowDown:[0,-1], ArrowLeft:[-1,0], ArrowRight:[1,0] };
  if (directions[event.key]) {
    event.preventDefault();
    let file = files.indexOf(square[0]); let rank = Number(square[1]);
    const [dx, dy] = directions[event.key]; file = (file + dx + 8) % 8; rank = Math.min(8, Math.max(1, rank + dy));
    const next = `${files[file]}${rank}`; focusSquare = next;
    const nextButton = event.currentTarget.closest('.board-row').parentElement.querySelector(`[data-square="${next}"]`);
    event.currentTarget.tabIndex = -1; nextButton.tabIndex = 0; nextButton.focus();
  } else if (interactive && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSquare(square); }
}

function onSquare(square) {
  if (mode !== 'game' || outcome || recoveryBlocked) return;
  const piece = game.get(square);
  const candidate = selected && legalFrom(game, selected).includes(square);
  if (candidate) {
    const options = game.moves({ square: selected, verbose: true }).filter((move) => move.to === square);
    if (options.some((move) => move.promotion)) { showPromotion(selected, square); return; }
    makeMove(selected, square); return;
  }
  if (piece?.color === game.turn()) { selected = square; focusSquare = square; announce(`${turnName(piece.color)} ${piece.type === 'n' ? 'knight' : piece.type} selected on ${square}.`); }
  else if (selected) { selected = null; announce(`Selection cleared. ${turnName(game.turn())} to move.`); }
  render();
}

function showPromotion(from, to) {
  const options = $('promotion-options'); options.replaceChildren();
  for (const [type, label] of [['q','Queen'],['r','Rook'],['b','Bishop'],['n','Knight']]) {
    const button = document.createElement('button'); button.className = 'promotion-choice'; button.type = 'button';
    button.innerHTML = `<span aria-hidden="true">${glyphs[game.turn()][type]}</span><span>${label}</span>`;
    button.addEventListener('click', () => { $('promotion-dialog').close(); makeMove(from, to, type); }); options.append(button);
  }
  $('promotion-dialog').showModal();
}

function makeMove(from, to, promotion) {
  try {
    const intended = intendedMoveClaim(game, { from, to, ...(promotion ? { promotion } : {}) });
    if (intended) {
      pendingClaimIntent = { move: intended.move, san: intended.san, reasons: intended.reasons };
      $('intended-draw-copy').textContent = `Playing ${intended.san} would allow a draw by ${drawReasonsText(intended.reasons)}. Claim the draw, or play ${intended.san} instead.`;
      $('claim-intended-draw').textContent = 'Claim draw';
      $('play-intended-move').textContent = `Play ${intended.san} instead`;
      $('intended-draw-dialog').showModal();
      return;
    }
    applyMove(from, to, promotion);
  } catch { announce('That move is not legal. The board and turn have not changed.'); }
}

function applyMove(from, to, promotion) {
  try {
    const move = game.move({ from, to, ...(promotion ? { promotion } : {}) });
    selected = null; focusSquare = to; outcome = gameOutcome(game); pendingDrawOffer = null;
    persist(); render();
    if (promotion) board.querySelector(`[data-square="${focusSquare}"]`)?.focus();
    announce(`${turnName(move.color)} ${move.piece === 'n' ? 'knight' : move.piece} ${move.captured ? 'captures on' : 'moves to'} ${to}.${game.isCheck() ? ` ${turnName(game.turn())} is in check.` : ''}${outcome ? ` ${outcome.text}` : ` ${turnName(game.turn())} to move.`}`);
  } catch { announce('That move is not legal. The board and turn have not changed.'); }
}

function renderMoves(chess, list, currentMoveIndex = -1) {
  const history = chess.history(); list.replaceChildren();
  if (!history.length) { const empty = document.createElement('li'); empty.className = 'empty-moves'; empty.textContent = 'Moves will appear here.'; list.append(empty); return; }
  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement('li'); row.className = 'move-row';
    const number = document.createElement('span'); number.className = 'move-number'; number.textContent = `${Math.floor(i / 2) + 1}.`;
    const white = document.createElement('span'); white.textContent = history[i];
    const black = document.createElement('span'); black.textContent = history[i + 1] ?? '';
    if (currentMoveIndex === i) { white.classList.add('current-move'); white.setAttribute('aria-current', 'step'); row.classList.add('active-move'); }
    if (currentMoveIndex === i + 1) { black.classList.add('current-move'); black.setAttribute('aria-current', 'step'); row.classList.add('active-move'); }
    row.append(number, white, black); list.append(row);
  }
}

function renderMaterial() {
  const history = game.history({ verbose: true }); const captured = { w: [], b: [] };
  for (const move of history) if (move.captured) captured[move.color === 'w' ? 'b' : 'w'].push(move.captured);
  const label = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
  $('material').replaceChildren();
  for (const color of ['w','b']) {
    const line = document.createElement('span'); line.className = 'captured-line';
    line.setAttribute('aria-label', `${color === 'w' ? 'White' : 'Black'} captured: ${captured[color].map((p) => label[p]).join(', ') || 'none'}`);
    const side = document.createElement('span'); side.className = 'captured-side'; side.textContent = color === 'w' ? 'White' : 'Black';
    const pieces = document.createElement('span'); pieces.className = 'captured-pieces';
    pieces.textContent = captured[color].map((p) => glyphs[color][p]).join(' ') || 'None';
    line.append(side, pieces); $('material').append(line);
  }
}

function render() {
  const keepBoardFocus = board.contains(document.activeElement);
  const gameVisible = mode === 'game'; $('game-section').hidden = !gameVisible; $('board-frame').hidden = !gameVisible;
  $('turn-bar').hidden = !gameVisible; $('board-help').hidden = !gameVisible;
  renderBoard(board, game, true); renderMoves(game, $('move-list'), game.history().length - 1); renderMaterial();
  $('turn-copy').textContent = outcome ? outcome.text : `${turnName(game.turn())} to move`;
  $('turn-bar').setAttribute('aria-label', outcome ? outcome.text : `${turnName(game.turn())} to move`);
  $('check-label').hidden = !game.isCheck() || !!outcome;
  $('result').hidden = !outcome; $('result').textContent = outcome?.text ?? '';
  const claimReasons = outcome ? [] : claimableDrawReasons(game);
  $('claim-draw').hidden = claimReasons.length === 0;
  $('claim-draw-help').hidden = claimReasons.length === 0;
  $('claim-draw-help').textContent = claimReasons.length ? `Claimable now: ${drawReasonsText(claimReasons)}.` : '';
  $('draw-agreement').disabled = !!outcome || game.history().length < 2 || !!pendingDrawOffer;
  $('draw-offer-response').hidden = !pendingDrawOffer || !!outcome;
  $('draw-offer-copy').textContent = pendingDrawOffer ? `${turnName(pendingDrawOffer.offeredBy)} offers a draw.` : '';
  $('draw-agreement').textContent = outcome?.kind === 'agreement' ? 'Draw agreed' : 'Offer a draw';
  $('new-game').textContent = outcome ? 'New game' : 'New game';
  $('replay-panel').hidden = mode !== 'replay';
  if (mode === 'replay') renderReplay();
  if (keepBoardFocus) board.querySelector(`[data-square="${focusSquare}"]`)?.focus();
}

function startNewGame() {
  game = new Chess(); outcome = null; pendingDrawOffer = null; pendingClaimIntent = null; selected = null; recoveryBlocked = false; mode = 'game'; persist(); render(); announce('New game. White to move.');
}

$('new-game').addEventListener('click', () => {
  if (game.history().length && !outcome) $('new-game-dialog').showModal(); else startNewGame();
});
$('confirm-new').addEventListener('click', (event) => { event.preventDefault(); $('new-game-dialog').close(); startNewGame(); });
$('recovery-new').addEventListener('click', (event) => { event.preventDefault(); $('recovery-dialog').close(); startNewGame(); });
$('draw-agreement').addEventListener('click', () => {
  if (outcome || mode !== 'game' || game.history().length < 2 || pendingDrawOffer) return;
  pendingDrawOffer = { offeredBy: game.history({ verbose: true }).at(-1).color };
  persist(); render(); announce(`${turnName(pendingDrawOffer.offeredBy)} offers a draw.`);
});
$('accept-draw-offer').addEventListener('click', () => {
  if (!pendingDrawOffer || outcome || mode !== 'game') return;
  outcome = offerDraw(game); pendingDrawOffer = null; persist(); render(); announce(outcome.text);
});
$('decline-draw-offer').addEventListener('click', () => {
  if (!pendingDrawOffer || outcome || mode !== 'game') return;
  pendingDrawOffer = null; persist(); render(); announce(`${turnName(game.turn())} declined the draw offer.`);
});
$('claim-draw').addEventListener('click', () => {
  const reasons = claimableDrawReasons(game);
  if (!reasons.length || outcome || mode !== 'game') return;
  pendingCurrentClaimReasons = reasons;
  $('current-draw-copy').textContent = `The current position qualifies for a draw by ${drawReasonsText(reasons)}. Claim it now, or keep playing.`;
  $('current-draw-dialog').showModal();
});
$('current-draw-dialog').addEventListener('cancel', () => { pendingCurrentClaimReasons = null; });
$('cancel-current-draw').addEventListener('click', () => { pendingCurrentClaimReasons = null; $('current-draw-dialog').close(); });
$('confirm-current-draw').addEventListener('click', () => {
  const reasons = pendingCurrentClaimReasons;
  pendingCurrentClaimReasons = null;
  $('current-draw-dialog').close();
  if (!reasons?.length || outcome || mode !== 'game') return;
  try { outcome = claimDraw(game, reasons[0], 'current'); pendingDrawOffer = null; persist(); render(); announce(outcome.text); }
  catch { announce('That draw claim is no longer valid. The board and turn have not changed.'); }
});
$('intended-draw-dialog').addEventListener('cancel', () => { pendingClaimIntent = null; });
$('claim-intended-draw').addEventListener('click', () => {
  if (!pendingClaimIntent) return;
  try {
    outcome = claimDraw(game, pendingClaimIntent.reasons[0], 'intended', pendingClaimIntent.move);
    pendingClaimIntent = null; selected = null; $('intended-draw-dialog').close(); persist(); render(); announce(outcome.text);
  } catch { pendingClaimIntent = null; $('intended-draw-dialog').close(); announce('That draw claim is no longer valid. The board and turn have not changed.'); }
});
$('play-intended-move').addEventListener('click', () => {
  if (!pendingClaimIntent) return;
  const { from, to, promotion } = pendingClaimIntent.move;
  pendingClaimIntent = null; $('intended-draw-dialog').close(); applyMove(from, to, promotion);
});

function replayPosition(index) { return replay.at(index); }
function renderReplay() {
  const position = replayPosition(replayIndex); renderBoard(replayBoard, position, false, replayIndex);
  renderMoves(position, $('replay-moves'), replayIndex - 1);
  const moveNumber = Math.ceil(replayIndex / 2); const san = replayIndex ? replay.moves[replayIndex - 1] : null;
  $('replay-progress').textContent = replayIndex === 0 ? 'Starting position' : replayIndex === replay.moves.length ? `Checkmate · ${moveNumber} moves` : `${turnName(position.turn())} to move · ${san}`;
  $('replay-start').textContent = replayTimer ? 'Pause' : 'Play';
  $('replay-back').disabled = replayIndex === 0; $('replay-next').disabled = replayIndex === replay.moves.length;
}
function stopReplay() { if (replayTimer) clearInterval(replayTimer); replayTimer = null; }
function showReplay() { stopReplay(); mode = 'replay'; replayIndex = 0; render(); $('replay-close').focus(); }
$('replay-open').addEventListener('click', showReplay);
$('replay-close').addEventListener('click', () => { stopReplay(); mode = 'game'; render(); $('replay-open').focus(); });
$('replay-back').addEventListener('click', () => { stopReplay(); replayIndex = Math.max(0, replayIndex - 1); renderReplay(); });
$('replay-next').addEventListener('click', () => { replayIndex = Math.min(replay.moves.length, replayIndex + 1); renderReplay(); if (replayIndex === replay.moves.length) stopReplay(); });
$('replay-reset').addEventListener('click', () => { stopReplay(); replayIndex = 0; renderReplay(); });
$('replay-start').addEventListener('click', () => {
  if (replayTimer) { stopReplay(); renderReplay(); return; }
  if (replayIndex >= replay.moves.length) replayIndex = 0;
  renderReplay();
  replayTimer = setInterval(() => { replayIndex++; renderReplay(); if (replayIndex >= replay.moves.length) { stopReplay(); renderReplay(); } }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1700 : 1100);
});

loadSavedGame();
render();
