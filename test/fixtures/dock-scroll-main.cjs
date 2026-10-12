'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
app.setPath('userData', path.join(process.argv[2], 'profile'));
if (process.argv.includes('--reduced-motion')) app.commandLine.appendSwitch('force-prefers-reduced-motion');
app.on('window-all-closed', () => app.quit());
app.whenReady().then(async () => {
  const preview = process.argv.includes('--preview');
  const win = new BrowserWindow({ width: 900, height: 720, show: preview, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(process.argv[2], 'dock.html'));
    await win.webContents.executeJavaScript('dockTest.settle()');
    if (preview) return;
    const result = await win.webContents.executeJavaScript('runDockTests()');
    result.push(...await win.webContents.executeJavaScript('runDockStressTests()'));
    const suffix = process.argv.includes('--reduced-motion') ? '-reduced' : '';
    if (process.env.DOCK_SCROLL_EVIDENCE) fs.writeFileSync(path.join(process.env.DOCK_SCROLL_EVIDENCE, `after-full${suffix}.png`), (await win.webContents.capturePage()).toPNG());
    // Real keyboard input establishes :focus-visible, unlike focus() after a
    // scripted mouse click. Space must activate the native button too.
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    const ring = await win.webContents.executeJavaScript(`(() => { dockTest.jump().focus(); return getComputedStyle(dockTest.jump()).outlineStyle; })()`);
    if (ring === 'none') throw new Error('keyboard focus ring missing');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await win.webContents.executeJavaScript('dockTest.settle()');
    if (!await win.webContents.executeJavaScript('dockTest.bottom() <= 1 && !dockTest.jump()')) throw new Error('Space did not activate jump');
    result.push('real keyboard focus ring and Space activation');
    win.setSize(900, 480);
    await win.webContents.executeJavaScript(`(async () => {
      dockTest.reset(); await dockTest.settle();
      dockTest.list().scrollTop = 200; await dockTest.settle();
      dockTest.append(); await dockTest.settle();
      const button = dockTest.jump().getBoundingClientRect();
      const dock = document.querySelector('.cth-dock').getBoundingClientRect();
      if (button.top < dock.top || button.bottom > dock.bottom || dock.top < 0) throw new Error('short window clips jump control');
    })()`);
    result.push('short window');
    const errors = await win.webContents.executeJavaScript('dockRuntimeErrors');
    if (errors.length) throw new Error(`renderer errors: ${errors.join('; ')}`);
    if (process.argv.includes('--reduced-motion') && !await win.webContents.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches')) throw new Error('reduced motion was not enabled');
    console.log(JSON.stringify(result));
    if (process.env.DOCK_SCROLL_EVIDENCE) fs.writeFileSync(path.join(process.env.DOCK_SCROLL_EVIDENCE, `after-short${suffix}.png`), (await win.webContents.capturePage()).toPNG());
    app.exit(0);
  } catch (e) { console.error(e.stack); app.exit(1); }
});
