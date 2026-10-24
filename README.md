# Browser Chess

A standalone, same-device chess game for two players. It runs in the browser and keeps the current game on the device.

## Play

Choose a piece and then a highlighted destination, or use the arrow keys to navigate the board and Enter or Space to select. The game enforces legal moves, including castling, en passant, and all four promotion choices. It recognizes checkmate, stalemate, threefold repetition, the fifty-move rule, insufficient material, and draw by agreement.

The current game and move history are saved in local browser storage. If storage is unavailable, the game stays playable for the current session and reports that reload recovery is unavailable. The Opera Game replay is a separate board and does not replace the current match.

## Develop

Requires Node.js 20.19+ or 22.12+ for the Vite 8 toolchain.

```sh
npm install
npm test
npm run test:browser
npm run dev
npm run build
npm run test:base-path
```

The browser suite requires Playwright Chromium; install it with `npx playwright install chromium` if it is not already available. The built static site is written to `dist/`. Vite uses `/browser-chess/` as its base path for the live GitHub Pages site at `https://dxnnystyles.github.io/browser-chess/`; deployment is managed by this repository’s workflow. The game does not use an account, server, analytics, or chess service. `chess.js` supplies legal-move and rules handling.
