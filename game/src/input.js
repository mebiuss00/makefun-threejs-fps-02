// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Held keys live in a Set; keys that went down since the last frame are kept in
// a second Set the game drains once a frame, so menus and single presses (buy,
// reload, plant) read edges while movement reads levels.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = {
    keys, locked: false, firing: false, clicked: false, aiming: false,
    lookX: 0, lookY: 0, wheel: 0,
  };

  window.addEventListener('keydown', (event) => {
    if (!event.repeat) pressed.add(event.code);
    keys.add(event.code);
    if (['Space', 'Tab', 'KeyB'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) { state.firing = true; state.clicked = true; }
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('wheel', (event) => {
    if (state.locked) state.wheel += Math.sign(event.deltaY);
  }, { passive: true });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() { canvas.requestPointerLock(); },
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    /** Drain the look delta accumulated since the last call. */
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
    /** True once for each key that went down since the last drain. */
    wasPressed(code) {
      return pressed.has(code);
    },
    /** Drain all edge state; call once at the end of a frame. */
    endFrame() {
      pressed.clear();
      state.clicked = false;
      state.wheel = 0;
    },
  };
}
