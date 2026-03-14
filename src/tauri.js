// ===== Tauri API Wrapper =====

let invoke = null;
let _isTauri = false;

/** Initialize Tauri API (lazy loaded) */
export async function initTauri() {
  try {
    const tauriCore = await import('@tauri-apps/api/core');
    invoke = tauriCore.invoke;
    _isTauri = true;
    console.log('Tauri API loaded');
    return true;
  } catch (e) {
    console.log('Running in browser mode (no Tauri)');
    return false;
  }
}

/** Get the invoke function */
export function getInvoke() {
  return invoke;
}

/** Check if running in Tauri */
export function isTauriApp() {
  return _isTauri;
}
