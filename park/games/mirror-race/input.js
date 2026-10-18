// The car faces local +Z: positive yaw turns LEFT in the rear chase camera.
// Human controls intentionally invert screen-space left and right.
// Keep this mapping shared by desktop and the platform's phone stick.
export function readControls(down,recover=false) {
  return {
    throttle:Number(down('KeyW')||down('ArrowUp')),
    brake:Number(down('KeyS')||down('ArrowDown')),
    steer:Number(down('KeyD')||down('ArrowRight')||down('KeyE'))-Number(down('KeyA')||down('ArrowLeft')||down('KeyQ')),
    boost:down('ShiftLeft')||down('ShiftRight'),recover
  };
}
