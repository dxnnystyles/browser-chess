import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { SAVE_VERSION, claimDraw, claimableDrawReasons, createGame, createOperaReplay, gameOutcome, intendedMoveClaim, offerDraw, positionKey, positionKeyHistory, repetitionCount, restoreGame, serializeGame } from '../src/chess-state.js';

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

test('threefold and fifty-move thresholds are claimable and do not end the game automatically', () => {
  const repeated = new Chess();
  for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) repeated.move(move);
  assert.equal(repeated.isThreefoldRepetition(), true);
  assert.equal(repetitionCount(repeated), 3);
  assert.deepEqual(claimableDrawReasons(repeated), ['threefold']);
  assert.equal(gameOutcome(repeated), null);
  assert.equal(claimDraw(repeated, 'threefold').basis, 'current');
  const fifty = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 99 50');
  fifty.move('Ra2');
  assert.equal(fifty.isDraw(), true);
  assert.deepEqual(claimableDrawReasons(fifty), ['fifty-move']);
  assert.equal(gameOutcome(fifty), null);
  assert.equal(claimDraw(fifty, 'fifty-move').claimKind, 'fifty-move');
});

test('position repetition keys include side, castling and legal en passant but exclude clocks', () => {
  const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(positionKey(new Chess(initial)), positionKey(new Chess(initial.replace(' 0 1', ' 87 52'))));
  assert.notEqual(positionKey(new Chess(initial)), positionKey(new Chess(initial.replace(' w ', ' b '))));
  assert.notEqual(positionKey(new Chess(initial)), positionKey(new Chess(initial.replace('KQkq', 'KQ'))));

  const afterDoublePawnMove = new Chess(); afterDoublePawnMove.move('e4');
  assert.equal(afterDoublePawnMove.fen().split(' ')[3], '-', 'irrelevant en-passant targets are omitted by the public FEN');
  const legalEp = new Chess(); for (const san of ['e4','a6','e5','d5']) legalEp.move(san);
  assert.equal(legalEp.fen().split(' ')[3], 'd6');
  const noEp = new Chess(legalEp.fen().replace(' d6 ', ' - '));
  assert.notEqual(positionKey(legalEp), positionKey(noEp));
  const pinnedEp = new Chess('k7/8/8/r4pPK/8/8/8/8 w - f6 0 1');
  assert.equal(pinnedEp.fen().split(' ')[3], '-');
});

test('position keys and counts are rebuilt from legal move history', () => {
  const repeated = new Chess();
  for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) repeated.move(move);
  const keys = positionKeyHistory(repeated);
  assert.equal(keys.length, repeated.history().length + 1);
  assert.equal(keys.at(0), keys.at(-1));
  assert.equal(keys.filter((key) => key === keys.at(-1)).length, 3);
  assert.equal(repetitionCount(repeated), 3);
});

test('fivefold repetition and seventy-five moves are automatic draws with mate precedence', () => {
  const repeated = new Chess();
  for (let cycle = 0; cycle < 4; cycle++) for (const move of ['Nf3','Nf6','Ng1','Ng8']) repeated.move(move);
  assert.equal(repetitionCount(repeated), 5);
  assert.equal(gameOutcome(repeated).kind, 'fivefold');
  const seventyFive = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 149 75');
  seventyFive.move('Ra2');
  assert.equal(gameOutcome(seventyFive).kind, 'seventy-five-move');
  const mate = new Chess('7k/6Q1/5K2/8/8/8/8/8 b - - 150 80');
  assert.equal(mate.isCheckmate(), true);
  assert.equal(gameOutcome(mate).kind, 'checkmate');
});

test('intended-move claims validate the exact move and leave the original position untouched', () => {
  const repeated = new Chess();
  for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1']) repeated.move(move);
  const before = repeated.fen();
  const intended = intendedMoveClaim(repeated, { from: 'f6', to: 'g8' });
  assert.equal(intended.san, 'Ng8');
  assert.deepEqual(intended.reasons, ['threefold']);
  assert.equal(repeated.fen(), before);
  const claim = claimDraw(repeated, 'threefold', 'intended', intended.move);
  assert.equal(claim.basis, 'intended');
  assert.deepEqual(claim.intendedMove, { from: 'f6', to: 'g8' });

  const fifty = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 99 50');
  const fiftyIntent = intendedMoveClaim(fifty, { from: 'a1', to: 'a2' });
  assert.equal(fiftyIntent.san, 'Ra2');
  assert.deepEqual(fiftyIntent.reasons, ['fifty-move']);
  assert.throws(() => intendedMoveClaim(fifty, { from: 'a1', to: 'a2', promotion: 'q' }), /legal/);
  assert.throws(() => intendedMoveClaim(fifty, { from: 'a1', to: 'b2' }), /legal/);

  const matingFifty = new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 99 50');
  const matingFen = matingFifty.fen();
  const matingHistory = matingFifty.history({ verbose: true });
  const matingIntent = intendedMoveClaim(matingFifty, { from: 'g6', to: 'g7' });
  assert.equal(matingIntent.san, 'Qg7#');
  assert.deepEqual(matingIntent.reasons, ['fifty-move']);
  assert.equal(claimDraw(matingFifty, 'fifty-move', 'intended', matingIntent.move).basis, 'intended');
  assert.equal(matingFifty.fen(), matingFen, 'claiming before the intended mate must preserve the current position');
  assert.deepEqual(matingFifty.history({ verbose: true }), matingHistory);
  const playedMate = new Chess(matingFen); playedMate.move({ from: 'g6', to: 'g7' });
  assert.equal(gameOutcome(playedMate).kind, 'checkmate', 'a played checkmate takes precedence over automatic draw rules');

  const promotion = new Chess('7k/P7/8/8/8/8/8/7K w - - 99 50');
  assert.throws(() => intendedMoveClaim(promotion, { from: 'a7', to: 'a8' }), /legal/, 'promotion must name the selected piece');
  assert.equal(intendedMoveClaim(promotion, { from: 'a7', to: 'a8', promotion: 'n' }), null);
});

test('save v2 persists and validates current/intended claims and pending draw offers', () => {
  const repeated = new Chess();
  for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) repeated.move(move);
  const currentClaim = claimDraw(repeated, 'threefold');
  const currentSave = serializeGame(repeated, currentClaim);
  assert.equal(currentSave.version, 2);
  assert.equal(currentSave.drawClaim.basis, 'current');
  assert.equal('repetitionCounts' in currentSave, false);
  assert.equal(restoreGame(currentSave).savedOutcome.kind, 'claim');
  assert.throws(() => restoreGame({ ...currentSave, drawClaim: { kind: 'threefold', basis: 'current' }, moves: [] }), /no longer valid/);

  const intendedGame = new Chess();
  for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1']) intendedGame.move(move);
  const intended = intendedMoveClaim(intendedGame, { from: 'f6', to: 'g8' });
  const intendedClaim = claimDraw(intendedGame, 'threefold', 'intended', intended.move);
  const intendedSave = serializeGame(intendedGame, intendedClaim);
  assert.deepEqual(restoreGame(intendedSave).savedOutcome.intendedMove, { from: 'f6', to: 'g8' });
  assert.throws(() => restoreGame({ ...intendedSave, drawClaim: { ...intendedSave.drawClaim, intendedMove: { from: 'f6', to: 'e5' } } }), /legal|valid/);

  const offered = new Chess(); offered.move('e4'); offered.move('e5');
  const offerSave = serializeGame(offered, null, { offeredBy: 'b' });
  assert.deepEqual(restoreGame(offerSave).savedDrawOffer, { offeredBy: 'b' });
  assert.throws(() => restoreGame(serializeGame(new Chess(), null, { offeredBy: 'w' })), /invalid/);
});

test('v1 saves migrate claimable thresholds without auto-accepting them and preserve agreements', () => {
  const moves = [];
  const repeated = new Chess();
  for (const san of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) {
    const move = repeated.move(san); moves.push({ from: move.from, to: move.to });
  }
  const migrated = restoreGame({ version: 1, moves });
  assert.equal(migrated.savedOutcome, null);
  assert.deepEqual(claimableDrawReasons(migrated), ['threefold']);
  assert.equal(serializeGame(migrated).version, SAVE_VERSION);
  assert.equal(restoreGame({ version: 1, moves: [], result: 'agreement' }).savedOutcome.kind, 'agreement');
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
