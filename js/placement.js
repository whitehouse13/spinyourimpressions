// Where to put the AR scene so the ring sits over the cup's axis, not over
// the tracked landmark crop. The tracked target is a crop of the inner
// panorama centred on a landmark; when the inner layer is turned so the
// landmark isn't centred in the window (phone test 2026-10-03), the target
// sits off to one side of the cup and faces the camera at an angle. Its
// surface normal then points along the cup's radius, so the axis lies
// r·s behind the target along that normal, not along the camera's -z.
// Only yaw is used — the ring stays upright (MindAR's tilt on this curved
// target jittered, 2026-09-30).

export const YAW_MAX = Math.PI / 6;

// Yaw of the target's normal (its local +z) in camera space, clamped to
// ±YAW_MAX around the direction from the target to the camera.
export function yawFromQuat(q, p) {
  const nx = 2 * (q.x * q.z + q.w * q.y);
  const nz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const yaw = Math.atan2(nx, nz);
  const los = Math.atan2(-p.x, -p.z);
  return Math.min(los + YAW_MAX, Math.max(los - YAW_MAX, yaw));
}

// scene.js keeps the cup axis at root + (0, 0, -r·s); place root so that
// axis = p − r·s·(sin yaw, 0, cos yaw). yaw = 0 → root = p (old behaviour).
export function rootPosition(p, yaw, r, s) {
  const k = r * s;
  return { x: p.x - k * Math.sin(yaw), y: p.y, z: p.z - k * (Math.cos(yaw) - 1) };
}
