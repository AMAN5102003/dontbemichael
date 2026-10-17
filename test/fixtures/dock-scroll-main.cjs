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
    await win.webContents.executeJavaScript("dockTest.until(() => document.querySelector('.cth-dock'), 'dock mounts')");
    if (preview) return;
    const result = await win.webContents.executeJavaScript('runDockTests()');
    result.push(...await win.webContents.executeJavaScript('runDockStressTests()'));
    const suffix = process.argv.includes('--reduced-motion') ? '-reduced' : '';
    if (process.env.DOCK_SCROLL_EVIDENCE) fs.writeFileSync(path.join(process.env.DOCK_SCROLL_EVIDENCE, `after-full${suffix}.png`), (await win.webContents.capturePage()).toPNG());
    // Real keyboard input from the composer, the way an owner reaches the
    // control. Poll each expected result: native input may arrive later.
    const js = (code) => win.webContents.executeJavaScript(code);
    const press = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    };
    win.webContents.focus();
    await js(`document.querySelector('textarea').focus()`);
    await press('Tab', ['shift']);
    await js("dockTest.until(() => document.activeElement === dockTest.jump(), 'Shift+Tab from the composer did not reach the jump control')");
    if (await js('getComputedStyle(dockTest.jump()).outlineStyle') === 'none') throw new Error('keyboard focus ring missing');
    await press('Space');
    await js("dockTest.until(() => dockTest.bottom() <= 1 && !dockTest.jump(), 'Space did not activate jump')");
    // The button unmounts once caught up. Its focus must not fall to the body.
    await js("dockTest.until(() => document.activeElement === document.querySelector('textarea'), 'jump dropped keyboard focus')");
    result.push('real keyboard focus ring, Space activation and focus return');
    const previousHeight = await js('innerHeight');
    win.setSize(900, 480);
    await js(`dockTest.until(() => innerHeight !== ${previousHeight}, 'short window resize is delivered')`);
    await win.webContents.executeJavaScript(`(async () => {
      dockTest.reset(); await dockTest.settle();
      await dockTest.scrollTo(200);
      dockTest.append(); await dockTest.settle();
      await dockTest.until(() => {
        const button = dockTest.jump()?.getBoundingClientRect();
        const dock = document.querySelector('.cth-dock').getBoundingClientRect();
        return button && button.top >= dock.top && button.bottom <= dock.bottom && dock.top >= 0;
      }, 'short window clips jump control');
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
