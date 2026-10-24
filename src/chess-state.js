import { Chess } from 'chess.js';

export const SAVE_KEY = 'dxnnystyles.browser-chess.v1';
export const SAVE_VERSION = 1;

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

export function serializeGame(chess, outcome = null) {
  return {
    version: SAVE_VERSION,
    moves: chess.history({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, ...(promotion ? { promotion } : {}) })),
    ...(outcome?.kind === 'agreement' ? { result: 'agreement' } : {}),
  };
}

export function restoreGame(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || value.version !== SAVE_VERSION || !Array.isArray(value.moves) || value.moves.length > 1000) {
    throw new Error('Saved game format is missing or incompatible.');
  }
  for (const move of value.moves) {
    if (!move || !/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to) || (move.promotion && !['q', 'r', 'b', 'n'].includes(move.promotion))) {
      throw new Error('Saved game contains an invalid move.');
    }
  }
  const chess = createGame(value.moves);
  if (value.result !== undefined && value.result !== 'agreement') throw new Error('Saved game result is invalid.');
  chess.savedOutcome = value.result === 'agreement' ? offerDraw(chess) : null;
  return chess;
}

export function gameOutcome(chess) {
  if (chess.isCheckmate()) return { kind: 'checkmate', text: `${chess.turn() === 'w' ? 'Black' : 'White'} wins by checkmate.` };
  if (chess.isStalemate()) return { kind: 'stalemate', text: 'Draw by stalemate.' };
  if (chess.isThreefoldRepetition()) return { kind: 'threefold', text: 'Draw by threefold repetition.' };
  if (chess.isInsufficientMaterial()) return { kind: 'material', text: 'Draw by insufficient material.' };
  if (chess.isDraw()) return { kind: 'fifty-move', text: 'Draw by the fifty-move rule.' };
  return null;
}

export function offerDraw(chess) {
  return { kind: 'agreement', text: 'Draw by agreement.' };
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
