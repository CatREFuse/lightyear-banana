struct Params {
  resolution: vec2f,
  pointer: vec2f,
  time: f32,
  rotationSpeed: f32,
  dispersion: f32,
  baseIor: f32,
  incidentAngle: f32,
  motion: f32,
}

@group(0) @binding(0) var<uniform> params: Params;

const PI: f32 = 3.14159265359;
const FAR: f32 = 10.0;

fn rotateX(angle: f32) -> mat3x3f {
  let c = cos(angle);
  let s = sin(angle);
  return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, c, s), vec3f(0.0, -s, c));
}

fn rotateY(angle: f32) -> mat3x3f {
  let c = cos(angle);
  let s = sin(angle);
  return mat3x3f(vec3f(c, 0.0, -s), vec3f(0.0, 1.0, 0.0), vec3f(s, 0.0, c));
}

fn rotateZ(angle: f32) -> mat3x3f {
  let c = cos(angle);
  let s = sin(angle);
  return mat3x3f(vec3f(c, s, 0.0), vec3f(-s, c, 0.0), vec3f(0.0, 0.0, 1.0));
}

fn layoutAmount() -> f32 {
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  return smoothstep(0.9, 1.35, aspect);
}

fn prismCenter() -> vec3f {
  return vec3f(-0.42 * layoutAmount(), -0.12, 0.0);
}

fn prismScale() -> f32 {
  return mix(0.34, 0.54, layoutAmount());
}

fn objectRotation() -> mat3x3f {
  let drift = params.time * params.rotationSpeed * 0.08 * params.motion;
  let yaw = 0.18 + params.pointer.x * 0.09 + sin(drift * 0.7) * 0.035;
  let pitch = 0.04 - params.pointer.y * 0.07 + sin(drift * 0.53) * 0.018;
  let roll = -0.012 + sin(drift) * 0.012;
  return rotateZ(roll) * rotateX(pitch) * rotateY(yaw);
}

fn sdEquilateralTriangle(point: vec2f, radius: f32) -> f32 {
  let k = 1.7320508;
  var p = vec2f(abs(point.x) - radius, point.y + radius / k);
  if (p.x + k * p.y > 0.0) {
    p = vec2f(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  }
  p.x = p.x - clamp(p.x, -2.0 * radius, 0.0);
  return -length(p) * sign(p.y);
}

fn sdTriangularPrism(worldPosition: vec3f) -> f32 {
  let scale = prismScale();
  let local = transpose(objectRotation()) * (worldPosition - prismCenter());
  let triangle = sdEquilateralTriangle(local.xy, scale);
  let frame = abs(triangle) - scale * 0.085;
  return max(frame, abs(local.z) - scale * 0.32);
}

fn estimateNormal(position: vec3f) -> vec3f {
  let e = 0.0016;
  return normalize(vec3f(
    sdTriangularPrism(position + vec3f(e, 0.0, 0.0)) - sdTriangularPrism(position - vec3f(e, 0.0, 0.0)),
    sdTriangularPrism(position + vec3f(0.0, e, 0.0)) - sdTriangularPrism(position - vec3f(0.0, e, 0.0)),
    sdTriangularPrism(position + vec3f(0.0, 0.0, e)) - sdTriangularPrism(position - vec3f(0.0, 0.0, e))
  ));
}

fn sphereBounds(origin: vec3f, direction: vec3f, center: vec3f, radius: f32) -> vec2f {
  let shiftedOrigin = origin - center;
  let b = dot(shiftedOrigin, direction);
  let c = dot(shiftedOrigin, shiftedOrigin) - radius * radius;
  let h = b * b - c;
  if (h < 0.0) { return vec2f(-1.0); }
  let root = sqrt(h);
  return vec2f(-b - root, -b + root);
}

fn marchSurface(origin: vec3f, direction: vec3f, bounds: vec2f) -> vec2f {
  var travel = max(bounds.x, 0.0);
  var signedDistance = FAR;
  for (var step: u32 = 0u; step < 58u; step = step + 1u) {
    signedDistance = sdTriangularPrism(origin + direction * travel);
    if (abs(signedDistance) < 0.0012 || travel > bounds.y) { break; }
    travel = travel + max(signedDistance * 0.72, 0.0035);
  }
  return vec2f(travel, signedDistance);
}

fn marchExit(origin: vec3f, direction: vec3f) -> vec3f {
  var travel = 0.012;
  var hit = origin + direction * travel;
  for (var step: u32 = 0u; step < 30u; step = step + 1u) {
    hit = origin + direction * travel;
    let signedDistance = sdTriangularPrism(hit);
    if (signedDistance > -0.001 && travel > 0.025) { break; }
    travel = travel + max(abs(signedDistance) * 0.7, 0.005);
  }
  return hit;
}

fn hash21(point: vec2f) -> f32 {
  let p = fract(point * vec2f(123.34, 456.21));
  return fract((p.x + p.y) * (p.x + p.y + 45.32));
}

fn segmentDistance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
  let segment = end - start;
  let projection = clamp(dot(point - start, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
  return length(point - (start + segment * projection));
}

fn beam(point: vec2f, start: vec2f, end: vec2f, width: f32) -> f32 {
  let segment = end - start;
  let projection = clamp(dot(point - start, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
  let distance = length(point - (start + segment * projection));
  let endFade = smoothstep(0.0, 0.08, projection) * smoothstep(1.0, 0.86, projection);
  let core = exp(-distance * distance / max(width * width, 0.00001));
  let halo = exp(-distance * distance / max(width * width * 11.0, 0.00001)) * 0.26;
  return (core + halo) * endFade;
}

fn spectralColor(position: f32) -> vec3f {
  let red = smoothstep(0.34, 0.0, abs(position - 0.04)) + smoothstep(0.31, 0.0, abs(position - 0.94));
  let green = smoothstep(0.29, 0.0, abs(position - 0.47));
  let blue = smoothstep(0.31, 0.0, abs(position - 0.72));
  return normalize(max(vec3f(red, green, blue), vec3f(0.001)));
}

fn opticalField(point: vec2f) -> vec3f {
  let center = prismCenter().xy;
  let scale = prismScale();
  let angle = params.incidentAngle * PI / 180.0;
  let entry = center + vec2f(-scale * 0.55, -scale * 0.03);
  let whiteDirection = normalize(vec2f(cos(angle), sin(angle) * 0.22));
  let incomingStart = entry - whiteDirection * 3.2;
  var light = vec3f(1.0, 1.0, 0.985) * beam(point, incomingStart, entry, 0.012) * 2.15;

  let internalExit = center + vec2f(scale * 0.55, scale * 0.015);
  light = light + vec3f(0.9, 0.96, 1.0) * beam(point, entry, internalExit, 0.012) * 0.48;

  let dispersion = params.dispersion * 0.0065 * mix(2.4, 1.0, layoutAmount());
  let spectrumStrength = mix(1.1, 0.72, layoutAmount());
  let iorShift = (params.baseIor - 1.3) * 0.075;
  for (var index: u32 = 0u; index < 9u; index = index + 1u) {
    let band = f32(index) / 8.0;
    let outgoingAngle = 0.012 - iorShift - (band - 0.5) * dispersion * 5.8;
    let direction = normalize(vec2f(cos(outgoingAngle), sin(outgoingAngle)));
    let width = mix(0.024, 0.015, abs(band - 0.5) * 2.0);
    let intensity = beam(point, internalExit, internalExit + direction * 3.5, width);
    light = light + spectralColor(band) * intensity * spectrumStrength;
  }

  let entryGlow = exp(-dot(point - entry, point - entry) * 120.0);
  let exitGlow = exp(-dot(point - internalExit, point - internalExit) * 105.0);
  return light + vec3f(0.92, 0.97, 1.0) * entryGlow * 0.52 + vec3f(1.0) * exitGlow * 0.2;
}

fn background(point: vec2f) -> vec3f {
  let center = prismCenter().xy;
  let haloPoint = (point - center) * vec2f(0.75, 1.15);
  let radial = exp(-dot(haloPoint, haloPoint) * 1.6);
  let cell = floor((point + vec2f(params.time * 0.0015 * params.motion, 0.0)) * 94.0);
  let dust = select(0.0, 0.06, hash21(cell) > 0.9985) * radial;
  return vec3f(0.0015, 0.0018, 0.0024) + vec3f(0.012, 0.015, 0.022) * radial + vec3f(dust);
}

fn environment(direction: vec3f) -> vec3f {
  let sideStrip = pow(max(direction.x * 0.7 + direction.y * 0.18, 0.0), 18.0);
  let topStrip = pow(max(direction.y, 0.0), 24.0);
  let floorStrip = pow(max(-direction.y * 0.72 + direction.x * 0.2, 0.0), 20.0);
  return vec3f(0.004, 0.005, 0.008) + vec3f(0.86, 0.91, 1.0) * sideStrip + vec3f(1.0) * topStrip * 0.72 + vec3f(0.24, 0.31, 0.42) * floorStrip;
}

fn glassColor(rayDirection: vec3f, hit: vec3f, normal: vec3f) -> vec3f {
  let ior = clamp(params.baseIor + 0.18, 1.3, 1.98);
  var insideDirection = refract(rayDirection, normal, 1.0 / ior);
  if (dot(insideDirection, insideDirection) < 0.0001) { insideDirection = reflect(rayDirection, normal); }
  let exitPoint = marchExit(hit - normal * 0.008, insideDirection);
  let exitNormal = estimateNormal(exitPoint);
  let spread = 0.009 * params.dispersion;
  let redDirection = refract(insideDirection, -exitNormal, ior + spread);
  let greenDirection = refract(insideDirection, -exitNormal, ior);
  let blueDirection = refract(insideDirection, -exitNormal, max(ior - spread, 1.01));
  let refracted = vec3f(environment(redDirection).r, environment(greenDirection).g, environment(blueDirection).b);
  let reflected = environment(reflect(rayDirection, normal));
  let facing = clamp(abs(dot(normal, -rayDirection)), 0.0, 1.0);
  let fresnel = 0.045 + 0.955 * pow(1.0 - facing, 4.5);
  let edge = pow(1.0 - facing, 2.2);
  let key = pow(max(dot(normal, normalize(vec3f(0.62, 0.54, 0.82))), 0.0), 42.0);
  return mix(refracted * vec3f(0.58, 0.72, 0.92), reflected, fresnel) + vec3f(0.72, 0.86, 1.0) * edge * 0.48 + vec3f(1.0) * key * 1.35;
}

fn edgeHighlights(point: vec2f) -> vec3f {
  let center = prismCenter().xy;
  let scale = prismScale();
  let top = center + vec2f(0.0, scale * 0.98);
  let left = center + vec2f(-scale, -scale * 0.71);
  let right = center + vec2f(scale, -scale * 0.71);
  let backOffset = vec2f(-scale * 0.075, scale * 0.045);
  let frontDistance = min(segmentDistance(point, top, left), min(segmentDistance(point, left, right), segmentDistance(point, right, top)));
  let backDistance = min(segmentDistance(point, top + backOffset, left + backOffset), min(segmentDistance(point, left + backOffset, right + backOffset), segmentDistance(point, right + backOffset, top + backOffset)));
  let connectorDistance = min(segmentDistance(point, top, top + backOffset), min(segmentDistance(point, left, left + backOffset), segmentDistance(point, right, right + backOffset)));
  let fineEdge = exp(-frontDistance * frontDistance / 0.000014) * 0.54;
  let softEdge = exp(-frontDistance * frontDistance / 0.00024) * 0.16;
  let backEdge = exp(-backDistance * backDistance / 0.000055) * 0.2;
  let connectors = exp(-connectorDistance * connectorDistance / 0.00004) * 0.24;
  let leftKeyDistance = segmentDistance(point, left, top);
  let leftKey = exp(-leftKeyDistance * leftKeyDistance / 0.000018) * 0.92;
  return vec3f(0.62, 0.76, 0.94) * (fineEdge + softEdge + backEdge + connectors) + vec3f(1.0) * leftKey;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let safeResolution = max(params.resolution, vec2f(1.0));
  let aspect = safeResolution.x / safeResolution.y;
  let portraitZoom = mix(0.68, 1.0, smoothstep(0.62, 1.0, aspect));
  var point = (uv * 2.0 - 1.0) / portraitZoom;
  point.x = point.x * aspect;
  point.y = -point.y;

  var color = background(point) + opticalField(point);
  let cameraOrigin = vec3f(0.0, 0.0, 3.45);
  let rayDirection = normalize(vec3f(point.x, point.y, -2.7));
  let bounds = sphereBounds(cameraOrigin, rayDirection, prismCenter(), prismScale() * 1.36);
  if (bounds.x >= 0.0 || bounds.y >= 0.0) {
    let hitResult = marchSurface(cameraOrigin, rayDirection, bounds);
    if (hitResult.x <= bounds.y && abs(hitResult.y) < 0.005) {
      let hit = cameraOrigin + rayDirection * hitResult.x;
      let normal = estimateNormal(hit);
      let glass = glassColor(rayDirection, hit, normal);
      let facing = clamp(abs(dot(normal, -rayDirection)), 0.0, 1.0);
      color = mix(color, glass + color * 0.24, 0.5 + facing * 0.2);
    }
  }

  color = color + edgeHighlights(point);
  let vignette = 1.0 - smoothstep(0.58, 1.8, length(point * vec2f(0.46, 0.72)));
  color = color * (0.67 + vignette * 0.33);
  color = color / (color + vec3f(1.0));
  color = pow(color, vec3f(0.84));
  return vec4f(color, 1.0);
}
