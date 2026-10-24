import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { SAVE_VERSION, createGame, createOperaReplay, gameOutcome, offerDraw, restoreGame, serializeGame } from '../src/chess-state.js';

test('standard opening, turn, capture and legal move enforcement', () => {
  const chess = new Chess();
  assert.equal(chess.moves().length, 20);
  chess.move('e4'); chess.move('d5'); chess.move('exd5');
  assert.equal(chess.get('d5').color, 'w');
  assert.throws(() => chess.move('e2e5'));
  assert.equal(chess.turn(), 'b');
});

test('check, checkmate and stalemate have distinct endings', () => {
  const mate = new Chess();
  for (const san of ['f3','e5','g4','Qh4#']) mate.move(san);
  assert.equal(mate.isCheck(), true);
  assert.deepEqual(gameOutcome(mate), { kind: 'checkmate', text: 'Black wins by checkmate.' });
  const stale = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stale.isStalemate(), true);
  assert.equal(gameOutcome(stale).kind, 'stalemate');
});

test('castling is available only when the king path is safe', () => {
  const canCastle = new Chess('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.ok(canCastle.moves({ verbose: true }).some((move) => move.san === 'O-O'));
  const throughCheck = new Chess('4kr2/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal(throughCheck.moves({ verbose: true }).some((move) => move.san === 'O-O'), false);
  const fromCheck = new Chess('4r1k1/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal(fromCheck.moves({ verbose: true }).some((move) => move.san === 'O-O'), false);
});

test('a move cannot expose the moving king to check', () => {
  const pinned = new Chess('k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1');
  assert.equal(pinned.moves({ square: 'e2' }).includes('d2'), false);
  const epPin = new Chess('k7/8/8/r4pPK/8/8/8/8 w - f6 0 1');
  assert.equal(epPin.moves({ square: 'g5' }).includes('f6'), false);
});

test('en passant is recognized and applied as a capture', () => {
  const chess = new Chess();
  for (const san of ['e4','a6','e5','d5']) chess.move(san);
  const move = chess.moves({ square: 'e5', verbose: true }).find((candidate) => candidate.to === 'd6');
  assert.equal(move?.flags.includes('e'), true);
  chess.move({ from: 'e5', to: 'd6' });
  assert.equal(chess.get('d5'), undefined);
  assert.equal(chess.get('d6').type, 'p');
});

test('all four promotion choices apply', () => {
  for (const promotion of ['q','r','b','n']) {
    const chess = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');
    chess.move({ from: 'a7', to: 'a8', promotion });
    assert.equal(chess.get('a8').type, promotion);
  }
});

test('threefold repetition and fifty-move rule end games', () => {
  const repeated = new Chess();
  for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) repeated.move(move);
  assert.equal(repeated.isThreefoldRepetition(), true);
  assert.equal(gameOutcome(repeated).kind, 'threefold');
  const fifty = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 99 50');
  fifty.move('Ra2');
  assert.equal(fifty.isDraw(), true);
  assert.equal(gameOutcome(fifty).kind, 'fifty-move');
});

test('insufficient material and agreement draws are represented', () => {
  const kings = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(gameOutcome(kings).kind, 'material');
  assert.equal(offerDraw(new Chess()).kind, 'agreement');
});

test('versioned persistence replays all moves and restores rule state', () => {
  const source = new Chess();
  for (const san of ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6']) source.move(san);
  const saved = serializeGame(source);
  assert.equal(saved.version, SAVE_VERSION);
  const restored = restoreGame(JSON.stringify(saved));
  assert.equal(restored.fen(), source.fen());
  assert.deepEqual(restored.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, ...(promotion ? { promotion } : {}) })), saved.moves);
  assert.deepEqual(restoreGame(serializeGame(createGame(saved.moves))).fen(), source.fen());
});

test('persistence rejects stale, malformed, and illegal move histories', () => {
  assert.throws(() => restoreGame({ version: 0, moves: [] }), /incompatible/);
  assert.throws(() => restoreGame('{'), /JSON/);
  assert.throws(() => restoreGame({ version: SAVE_VERSION, moves: [{ from:'z9', to:'a1' }] }), /invalid move/);
  assert.throws(() => restoreGame({ version: SAVE_VERSION, moves: [{ from:'e2', to:'e5' }] }), /no longer legal/);
});

test('an agreed draw survives a saved-game round trip', () => {
  const chess = new Chess(); const result = offerDraw(chess);
  const restored = restoreGame(serializeGame(chess, result));
  assert.equal(restored.savedOutcome.kind, 'agreement');
});

test('Opera Game move list is legal, ends in mate, and supports indexed positions', () => {
  const replay = createOperaReplay();
  assert.equal(replay.moves.length, 33);
  assert.equal(replay.moves.at(-1), 'Rd8#');
  assert.equal(replay.at(0).history().length, 0);
  assert.equal(replay.at(12).history().length, 12);
  assert.equal(replay.at(33).isCheckmate(), true);
});
