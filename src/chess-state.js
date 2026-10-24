import { Chess } from 'chess.js';

export const SAVE_KEY = 'dxnnystyles.browser-chess.v1';
export const SAVE_VERSION = 2;
const LEGACY_SAVE_VERSION = 1;
const claimNames = { threefold: 'threefold repetition', 'fifty-move': 'the fifty-move rule' };

function moveData(move) {
  return { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) };
}

function moveHistory(chess) { return chess.history({ verbose: true }).map(moveData); }

function startingPosition(chess) { return chess.header().FEN ? new Chess(chess.header().FEN) : new Chess(); }

function replayGame(chess) {
  const replay = startingPosition(chess);
  for (const move of moveHistory(chess)) replay.move(move);
  return replay;
}

export function createGame(moves = []) {
  const chess = new Chess();
  for (const move of moves) {
    try {
      const applied = chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
      if (!applied) throw new Error('Saved move is no longer legal.');
    } catch { throw new Error('Saved move is no longer legal.'); }
  }
  return chess;
}

export function positionKey(chess) { return chess.fen().split(' ').slice(0, 4).join(' '); }

export function positionKeyHistory(chess) {
  const replay = startingPosition(chess);
  const keys = [positionKey(replay)];
  for (const move of moveHistory(chess)) {
    replay.move(move);
    keys.push(positionKey(replay));
  }
  return keys;
}

export function repetitionCount(chess) {
  const key = positionKey(chess);
  return positionKeyHistory(chess).filter((entry) => entry === key).length;
}

export function claimableDrawReasons(chess) {
  const reasons = [];
  if (repetitionCount(chess) >= 3) reasons.push('threefold');
  if (Number(chess.fen().split(' ')[4]) >= 100) reasons.push('fifty-move');
  return reasons;
}

function autoMoveCountOutcome(chess) {
  if (repetitionCount(chess) >= 5) return { kind: 'fivefold', text: 'Draw by fivefold repetition.' };
  if (Number(chess.fen().split(' ')[4]) >= 150) return { kind: 'seventy-five-move', text: 'Draw by the seventy-five-move rule.' };
  return null;
}

export function gameOutcome(chess) {
  if (chess.isCheckmate()) return { kind: 'checkmate', text: `${chess.turn() === 'w' ? 'Black' : 'White'} wins by checkmate.` };
  if (chess.isStalemate()) return { kind: 'stalemate', text: 'Draw by stalemate.' };
  const automaticDraw = autoMoveCountOutcome(chess);
  if (automaticDraw) return automaticDraw;
  if (chess.isInsufficientMaterial()) return { kind: 'material', text: 'Draw by insufficient material.' };
  return null;
}

function intendedPosition(chess, intendedMove) {
  const before = replayGame(chess);
  const choices = before.moves({ square: intendedMove.from, verbose: true }).filter((move) => move.to === intendedMove.to);
  const needsPromotion = choices.some((move) => move.promotion);
  const choice = choices.find((move) => (move.promotion ?? undefined) === intendedMove.promotion);
  if (!choice || (needsPromotion && !intendedMove.promotion)) throw new Error('The intended move is no longer legal.');
  const after = replayGame(chess);
  const played = after.move(moveData(choice));
  return { chess: after, move: moveData(choice), san: played.san };
}

export function intendedMoveClaim(chess, move) {
  const intended = intendedPosition(chess, move);
  if (gameOutcome(intended.chess)) return null;
  const reasons = claimableDrawReasons(intended.chess);
  return reasons.length ? { ...intended, reasons } : null;
}

export function claimDraw(chess, kind, basis = 'current', intendedMove = null) {
  let reasons;
  let validatedMove = null;
  if (basis === 'current') reasons = claimableDrawReasons(chess);
  else if (basis === 'intended' && intendedMove) {
    const intended = intendedMoveClaim(chess, intendedMove);
    reasons = intended?.reasons ?? [];
    validatedMove = intended?.move ?? null;
  } else throw new Error('Draw claim basis is invalid.');
  if (gameOutcome(chess) || !reasons.includes(kind)) throw new Error('This draw claim is not valid in the current position.');
  return {
    kind: 'claim', claimKind: kind, basis, ...(validatedMove ? { intendedMove: validatedMove } : {}),
    text: `Draw claimed by ${claimNames[kind]}.`,
  };
}

export function offerDraw(chess) {
  return { kind: 'agreement', text: 'Draw by agreement.' };
}

export function serializeGame(chess, outcome = null, pendingOffer = null) {
  return {
    version: SAVE_VERSION,
    moves: moveHistory(chess),
    ...(outcome?.kind === 'agreement' ? { result: 'agreement' } : {}),
    ...(outcome?.kind === 'claim' ? { drawClaim: { kind: outcome.claimKind, basis: outcome.basis, ...(outcome.intendedMove ? { intendedMove: outcome.intendedMove } : {}) } } : {}),
    ...(pendingOffer ? { drawOffer: { offeredBy: pendingOffer.offeredBy } } : {}),
  };
}

function restoreClaim(chess, value) {
  if (!value || !['threefold', 'fifty-move'].includes(value.kind) || !['current', 'intended'].includes(value.basis)) throw new Error('Saved draw claim is invalid.');
  if (gameOutcome(chess)) throw new Error('Saved draw claim conflicts with an automatic game result.');
  if (value.basis === 'current') {
    if (value.intendedMove !== undefined || !claimableDrawReasons(chess).includes(value.kind)) throw new Error('Saved draw claim is no longer valid.');
    return claimDraw(chess, value.kind, 'current');
  }
  const move = value.intendedMove;
  if (!move || !/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to) || (move.promotion && !['q','r','b','n'].includes(move.promotion))) throw new Error('Saved intended draw claim is invalid.');
  const intended = intendedMoveClaim(chess, move);
  if (!intended?.reasons.includes(value.kind)) throw new Error('Saved intended draw claim is no longer valid.');
  return claimDraw(chess, value.kind, 'intended', intended.move);
}

function restorePendingOffer(chess, value) {
  if (!value || !['w','b'].includes(value.offeredBy) || chess.history().length < 2 || value.offeredBy === chess.turn() || gameOutcome(chess)) {
    throw new Error('Saved draw offer is invalid.');
  }
  const lastMove = chess.history({ verbose: true }).at(-1);
  if (lastMove?.color !== value.offeredBy) throw new Error('Saved draw offer does not match the last move.');
  return { offeredBy: value.offeredBy };
}

export function restoreGame(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || ![LEGACY_SAVE_VERSION, SAVE_VERSION].includes(value.version) || !Array.isArray(value.moves) || value.moves.length > 1000) {
    throw new Error('Saved game format is missing or incompatible.');
  }
  for (const move of value.moves) {
    if (!move || !/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to) || (move.promotion && !['q', 'r', 'b', 'n'].includes(move.promotion))) {
      throw new Error('Saved game contains an invalid move.');
    }
  }
  const chess = createGame(value.moves);
  if (value.result !== undefined && value.result !== 'agreement') throw new Error('Saved game result is invalid.');
  if (value.drawClaim !== undefined && value.result !== undefined) throw new Error('Saved game has conflicting draw results.');
  if (value.drawOffer !== undefined && (value.result !== undefined || value.drawClaim !== undefined)) throw new Error('Saved draw offer conflicts with a finished game.');
  chess.savedOutcome = value.result === 'agreement' ? offerDraw(chess) : value.drawClaim !== undefined ? restoreClaim(chess, value.drawClaim) : null;
  chess.savedDrawOffer = value.drawOffer !== undefined ? restorePendingOffer(chess, value.drawOffer) : null;
  chess.savedVersion = value.version;
  return chess;
}

export function createOperaReplay() {
  const chess = new Chess();
  const moves = [
    ['e4','e5'], ['Nf3','d6'], ['d4','Bg4'], ['dxe5','Bxf3'], ['Qxf3','dxe5'], ['Bc4','Nf6'],
    ['Qb3','Qe7'], ['Nc3','c6'], ['Bg5','b5'], ['Nxb5','cxb5'], ['Bxb5+','Nbd7'], ['O-O-O','Rd8'],
    ['Rxd7','Rxd7'], ['Rd1','Qe6'], ['Bxd7+','Nxd7'], ['Qb8+','Nxb8'], ['Rd8#'],
  ];
  const sans = [];
  for (const pair of moves) for (const san of pair) {
    const move = chess.move(san);
    if (!move) throw new Error(`Opera Game sequence is invalid at ${san}.`);
    sans.push(move.san);
  }
  if (!chess.isCheckmate() || sans.at(-1) !== 'Rd8#') throw new Error('Opera Game replay did not reach the verified mate.');
  return { moves: sans, at(index) {
    const position = new Chess();
    for (const san of sans.slice(0, index)) position.move(san);
    return position;
  } };
}
