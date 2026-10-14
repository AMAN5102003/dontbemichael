/** Whether app.relaunch() brings up a working window: not under `npm run dev`
 *  (see restartApp). Closing time asks too, so it only says "Reopening" when
 *  the app will. */
export function canRelaunch(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.ELECTRON_RENDERER_URL;
}

/** Restart the app after a reset or a home change.
 *
 *  Packaged (and `electron-vite preview`) builds load the renderer from disk, so
 *  app.relaunch() brings up a working window. Under `npm run dev` it cannot:
 *  electron-vite spawns Electron with `ps.on('close', process.exit)`, so the dev
 *  server dies with the first process, and the relaunched copy still points at
 *  ELECTRON_RENDERER_URL and opens blank. In dev we exit without relaunching and
 *  say how to come back; the reset itself has already happened. */
export function restartApp(
  app: { relaunch(): void; exit(code?: number): void },
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = console.log
): 'relaunched' | 'exited-dev' {
  if (!canRelaunch(env)) {
    log('[restart] dev mode: the dev server stops with this process, so not relaunching. Run npm run dev again.');
    app.exit(0);
    return 'exited-dev';
  }
  app.relaunch();
  app.exit(0);
  return 'relaunched';
}
