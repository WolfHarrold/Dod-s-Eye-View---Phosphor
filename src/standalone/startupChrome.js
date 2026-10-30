import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { initSkinShell } from '../ui/skins/skinShell.js';
export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings: initKeySetup,
    initializeSkin: initSkinShell,
    ...options,
  });
}
