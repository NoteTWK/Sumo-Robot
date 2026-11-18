(() => {
  "use strict";

  const FIELD_Y = 0.5;
  const HEIGHT_Y = Math.sqrt(3) / 2;
  const TEAM = ["#ff4438", "#45a4ff"];
  const ROBOT_SAMPLES = 2;
  const MODELS = {
    wedge: "#e6382c", iron: "#2871db", lightning: "#f4bd25",
    spin: "#9a52cd", grapple: "#24bc89", flip: "#eb7827",
  };
  const ICONS = { circle: "○", square: "□", oval: "⬭", triangle: "△", hexagon: "⬡" };
  const STEEL = "#7d8b97";
  const DARK = "#21272f";
  const RUBBER = "#171b21";
  const ALLOY = "#aab7c5";
  const LIGHT = "#bde9ff";
  const KEY_LIGHT = [-.31, -.22, .925];
  const RIM_LIGHT = [.8, .55, .24];
  const meshes = new Map();
  const attachments = new Map();
  const stages = new WeakMap();
  const impacts = new WeakMap();
  const motion = new WeakMap();
  const robotTiles = new WeakMap();
  const stageDepthFaces = new WeakMap();
  const ARENA_BASE = -.81;
  const FLOOR_LEVEL = -1.06;

  const scaleAboutCenter = (p, factor) => [p[0] * factor, p[1] * factor];
  const depth = p => p[1] * HEIGHT_Y + p[2] * FIELD_Y;
  const sub = (a, b) => a.map((n, index) => n - b[index]);
  const dot = (a, b) => a.reduce((total, n, index) => total + n * b[index], 0);

  function normal(points) {
    const [x, y, z] = sub(points[1], points[0]);
    const [u, v, w] = sub(points[2], points[0]);
    const n = [y * w - z * v, z * u - x * w, x * v - y * u];
    const length = Math.hypot(...n) || 1;
    return n.map(x => x / length);
  }

  function channels(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function path(ctx, points, close = true) {
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath();
  }

  function fill(ctx, points, paint) {
    path(ctx, points);
    ctx.fillStyle = paint;
    ctx.fill();
  }

  function stroke(ctx, points, paint, width, close = false) {
    path(ctx, points, close);
    ctx.strokeStyle = paint;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function radial(ctx, x, y, r, inner, outer) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    return gradient;
  }

  function box(mesh, x, y, z, length, width, height, color, emissive = false) {
    const corners = (hx, hy, elev) => [
      [x - hx, y - hy, elev], [x + hx, y - hy, elev],
      [x + hx, y + hy, elev], [x - hx, y + hy, elev],
    ];
    prism(mesh, corners(length / 2, width / 2, z - height / 2),
      corners(length / 2, width / 2, z + height / 2), color, emissive);
  }

  function prism(mesh, bottom, top, color, emissive = false) {
    const center = bottom[0].map((_, axis) =>
      [...bottom, ...top].reduce((sum, p) => sum + p[axis], 0) / (2 * top.length));
    const material = channels(color);
    const face = points => {
      let n = normal(points);
      if (dot(n, sub(points[0], center)) < 0) {
        points = [...points].reverse();
        n = n.map(value => -value);
      }
      mesh.push({ points, normal: n, material, emissive });
    };
    face(top);
    face(bottom);
    for (let i = 0; i < top.length; i++) {
      const j = (i + 1) % top.length;
      face([bottom[i], bottom[j], top[j], top[i]]);
    }
  }

  function cylinder(mesh, x, y, z, radius, thickness, color, axis = "z", sections = 16, phase = 0) {
    const end = offset => Array.from({ length: sections }, (_, index) => {
      const a = phase + index * Math.PI * 2 / sections;
      const u = radius * Math.cos(a);
      const v = radius * Math.sin(a);
      return axis === "y" ? [x + u, y + offset, z + v] : [x + u, y + v, z + offset];
    });
    prism(mesh, end(-thickness / 2), end(thickness / 2), color);
  }

  function shell(mesh, rear, front, rearWidth, frontWidth, base, rearHeight, frontHeight, color) {
    const profile = (a, b) => [
      [rear, -rearWidth / 2, a], [front, -frontWidth / 2, b],
      [front, frontWidth / 2, b], [rear, rearWidth / 2, a],
    ];
    prism(mesh, profile(base, base), profile(rearHeight, frontHeight), color);
  }

  function tread(mesh, x, y, z, radius, angle, color) {
    const ring = (r, a, side) => [x + Math.cos(a) * r, y + side * .077, z + Math.sin(a) * r];
    const section = r => [
      ring(r, angle - .095, -1), ring(r, angle + .095, -1),
      ring(r, angle + .095, 1), ring(r, angle - .095, 1),
    ];
    prism(mesh, section(radius - .023), section(radius), color);
  }

  function wheels(mesh, color, axleXs, width, radius = .205) {
    for (const side of [-1, 1]) {
      const y = side * width / 2;
      for (const x of axleXs) {
        const axleHeight = radius + .012;
        cylinder(mesh, x, y, axleHeight, radius - .011, .143, RUBBER, "y", 18);
        for (let i = 0; i < 14; i++) {
          tread(mesh, x, y, axleHeight, radius + .01, i * Math.PI / 7, i % 2 ? "#262b32" : "#30363d");
        }
        cylinder(mesh, x, y + side * .073, axleHeight, radius * .77, .024, "#383f46", "y");
        cylinder(mesh, x, y + side * .088, axleHeight, radius * .61, .022, color, "y");
        cylinder(mesh, x, y + side * .104, axleHeight, radius * .50, .020, DARK, "y");
        cylinder(mesh, x, y + side * .119, axleHeight, radius * .24, .018, ALLOY, "y", 8);
      }
    }
  }

  function grille(mesh, x, z, width = .26, count = 3) {
    for (let i = 0; i < count; i++) box(mesh, x + .05 * i, 0, z, .018, width, .012, DARK);
  }

  function bolts(mesh, xs, width, height) {
    for (const x of xs) {
      for (const y of [-width / 2, width / 2]) {
        cylinder(mesh, x, y, height, .027, .017, ALLOY, "z", 6);
      }
    }
  }

  function headlights(mesh, x, width, z, color = LIGHT) {
    for (const sign of [-1, 1]) box(mesh, x, sign * width / 2, z, .08, .10, .046, color, true);
  }

  function track(mesh, side, color) {
    const y = side * .49;
    const profile = [
      [-.62, .08], [-.47, .015], [.40, .015], [.58, .075],
      [.60, .24], [.43, .36], [-.48, .36], [-.64, .27],
    ];
    const outline = offset => profile.map(([x, z]) => [x, y + offset, z]);
    prism(mesh, outline(-.12), outline(.12), RUBBER);
    for (const x of [-.47, -.2, .06, .32, .47]) {
      cylinder(mesh, x, y + side * .123, .152, .105, .025, STEEL, "y", 12);
      cylinder(mesh, x, y + side * .14, .152, .063, .026, DARK, "y", 10);
      cylinder(mesh, x, y + side * .157, .152, .026, .015, ALLOY, "y", 6);
    }
    for (let i = 0; i < 12; i++) box(mesh, -.52 + i * .087, y, .36, .065, .242, .032, "#383f48");
    for (let i = 0; i < 5; i++) box(mesh, .592, y, .085 + i * .043, .025, .24, .027, "#323c48");
    box(mesh, -.08, y - side * .073, .387, .854, .068, .06, color);
  }

  function model(id) {
    const type = MODELS[id] ? id : "wedge";
    if (meshes.has(type)) return meshes.get(type);
    const color = MODELS[type];
    const mesh = [];
    switch (type) {
      case "wedge":
        wheels(mesh, color, [-.43, .15], .99);
        shell(mesh, -.65, -.27, .84, .89, .101, .405, .479, color);
        shell(mesh, -.27, .63, .89, 1.06, .060, .479, .166, color);
        shell(mesh, .63, .86, 1.06, 1.10, .047, .166, .068, ALLOY);
        shell(mesh, -.59, -.32, .41, .48, .350, .425, .479, "#414850");
        for (let i = 0; i < 3; i++) {
          const x = -.13 + i * .060;
          const height = .479 - (x + .27) * .313 / .9;
          box(mesh, x, 0, height + .007, .026, .245, .017, DARK);
        }
        bolts(mesh, [-.58], .73, .425);
        bolts(mesh, [.47], .83, .229);
        headlights(mesh, -.30, .70, .464, "#ffd5bc");
        break;
      case "iron":
        track(mesh, -1, color);
        track(mesh, 1, color);
        box(mesh, -.065, 0, .32, 1.01, .83, .25, color);
        shell(mesh, -.53, .48, .73, .83, .32, .515, .371, color);
        box(mesh, -.18, 0, .49, .50, .42, .054, color);
        grille(mesh, -.27, .526, .3, 4);
        box(mesh, .56, 0, .24, .11, 1.14, .36, "#525e6a");
        for (const y of [-.49, -.25, .25, .49]) box(mesh, .616, y, .188, .039, .10, .24, ALLOY);
        bolts(mesh, [-.48], .62, .515);
        headlights(mesh, .466, .57, .378);
        break;
      case "lightning":
        wheels(mesh, color, [-.48, .36], .84, .224);
        shell(mesh, -.64, -.32, .64, .70, .090, .348, .47, color);
        shell(mesh, -.32, .83, .70, .27, .085, .47, .119, color);
        box(mesh, -.17, 0, .307, .40, .30, .103, "#151d26");
        box(mesh, -.58, 0, .449, .10, .89, .07, color);
        for (const y of [-.285, .285]) {
          box(mesh, -.54, y, .360, .35, .125, .125, STEEL);
          box(mesh, -.724, y, .360, .06, .097, .07, "#ffad55", true);
        }
        headlights(mesh, .50, .31, .193, "#ffc763");
        break;
      case "spin":
        cylinder(mesh, 0, 0, .145, .605, .234, RUBBER, "z", 24);
        cylinder(mesh, 0, 0, .246, .648, .111, color, "z", 24);
        cylinder(mesh, 0, 0, .321, .521, .073, DARK, "z", 24);
        cylinder(mesh, 0, 0, .373, .377, .088, color, "z", 24);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const x = Math.cos(a) * .48;
          const y = Math.sin(a) * .48;
          cylinder(mesh, x, y, .37, .042, .057, i % 2 ? ALLOY : "#c983ff", "z", 8);
        }
        grille(mesh, -.10, .422, .22);
        headlights(mesh, .275, .22, .405, "#e7adff");
        break;
      case "grapple":
        wheels(mesh, color, [-.50, -.13], 1, .217);
        box(mesh, -.33, 0, .159, .55, .70, .17, DARK);
        box(mesh, -.28, 0, .283, .62, .85, .25, color);
        box(mesh, -.34, 0, .444, .36, .5, .10, color);
        grille(mesh, -.465, .501);
        headlights(mesh, .041, .48, .307, "#b1ffea");
        for (const y of [-.39, .39]) {
          const first = mesh.length;
          box(mesh, .23, y, .236, .90, .193, .205, color);
          box(mesh, .71, y, .228, .23, .251, .19, "#434e59");
          box(mesh, .821, y, .228, .034, .20, .13, RUBBER);
          for (let i = first; i < mesh.length; i++) mesh[i].part = y < 0 ? "claw-left" : "claw-right";
          cylinder(mesh, .02, y, .368, .08, .07, ALLOY, "z", 12);
        }
        break;
      case "flip":
        wheels(mesh, color, [-.42, .24], 1, .218);
        box(mesh, -.25, 0, .29, .62, .84, .246, color);
        shell(mesh, -.50, .32, .74, .82, .13, .43, .255, color);
        for (const y of [-.325, .325]) {
          box(mesh, -.03, y, .44, .56, .062, .10, "#52616c");
          cylinder(mesh, .17, y, .42, .084, .089, ALLOY, "y", 12);
        }
        const scoopStart = mesh.length;
        shell(mesh, .16, .70, .73, .97, .052, .279, .119, color);
        shell(mesh, .70, .91, .97, 1.03, .044, .119, .058, ALLOY);
        for (let i = scoopStart; i < mesh.length; i++) mesh[i].part = "scoop";
        grille(mesh, -.43, .442);
        headlights(mesh, .272, .38, .267, "#ffe1b5");
        break;
    }
    meshes.set(type, mesh);
    return mesh;
  }

  function riggedMesh(id, effect) {
    const base = model(id);
    const spinBlade = id === "spin" && (effect === "spin-charge" || effect === "spin-blade");
    if (!(id === "iron" && effect === "iron-spikes") && !spinBlade) return base;
    const attachment = spinBlade ? "spin-blade" : effect;
    if (attachments.has(attachment)) return attachments.get(attachment);
    const added = [];
    if (effect === "iron-spikes") {
      for (const y of [-.36, -.12, .12, .36]) {
        const profile = [[.60, y - .058], [.755, y], [.60, y + .058]];
        prism(added, profile.map(([x, y]) => [x, y, .16]), profile.map(([x, y]) => [x, y, .224]), "#d5edfb", true);
      }
      for (const face of added) face.part = "spikes";
    } else {
      for (let i = 0; i < 5; i++) {
        const first = added.length;
        const angle = i * Math.PI * 2 / 5;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const blade = (outline, color) => {
          const shape = z => outline.map(([u, v]) => [u * cos - v * sin, u * sin + v * cos, z]);
          prism(added, shape(.233), shape(.274), color, true);
        };
        blade([[.61, -.14], [.75, -.125], [.825, .015], [.70, .035]], "#4df2f8");
        blade([[.70, .035], [.825, .015], [.824, .127], [.765, .105]], "#90ffff");
        for (let face = first; face < added.length; face++) added[face].part = "blade-" + i;
      }
    }
    const mesh = [...base, ...added];
    attachments.set(attachment, mesh);
    return mesh;
  }

  function partTransforms(effect, progress, bladeCharge) {
    if (effect === "iron-spikes") {
      const travel = Math.min(1, progress * 36, (1 - progress) * 29);
      return { spikes: ([x, y, z], point) => [x - (point ? (1 - travel) * .27 : 0), y, z] };
    }
    if (effect === "spin-charge" || effect === "spin-blade") {
      const charge = Math.max(0, Math.min(1, bladeCharge ?? (effect === "spin-charge" ? progress : 1)));
      // Slide each blade out from beneath the outer chassis. The furthest tooth
      // stays at the gameplay hull radius (.7) plus its growing .2-unit reach.
      const radius = (.7 + .2 * charge) / 1.08;
      const retract = .824 - Math.sqrt(radius * radius - .127 * .127);
      const parts = {};
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        const dx = Math.cos(angle) * retract, dy = Math.sin(angle) * retract;
        parts["blade-" + i] = ([x, y, z], point) => point ? [x - dx, y - dy, z] : [x, y, z];
      }
      return parts;
    }
    if (effect === "flip-scoop" || effect === "flip-overturn") {
      const snap = Math.min(1, progress * 4);
      const pitch = Math.sin(snap * Math.PI * .5) * Math.min(1, (1 - progress) * 2.6)
        * (effect === "flip-overturn" ? 1.02 : .73);
      const sin = Math.sin(pitch), cos = Math.cos(pitch);
      return { scoop: ([x, y, z], point) => {
        const ox = point ? .17 : 0, oz = point ? .19 : 0;
        return [ox + (x - ox) * cos - (z - oz) * sin, y, oz + (x - ox) * sin + (z - oz) * cos];
      } };
    }
    if (effect?.startsWith("grapple-")) {
      const grip = effect === "grapple-grab" ? progress : effect === "grapple-toss"
        ? Math.min(1, (1 - progress) * 5) : 1;
      const raise = effect === "grapple-toss" ? Math.sin(progress * Math.PI) * .55 :
        effect === "grapple-carry" ? .15 : 0;
      const sin = Math.sin(raise), cos = Math.cos(raise);
      const claw = side => {
        const yaw = -side * grip * .16;
        const yawSin = Math.sin(yaw), yawCos = Math.cos(yaw);
        return ([x, y, z], point) => {
          const ox = point ? .02 : 0, oy = point ? side * .39 : 0, oz = point ? .24 : 0;
          const a = (x - ox) * yawCos - (y - oy) * yawSin;
          return [ox + a * cos - (z - oz) * sin,
            oy + (x - ox) * yawSin + (y - oy) * yawCos,
            oz + (z - oz) * cos + a * sin];
        };
      };
      return { "claw-left": claw(-1), "claw-right": claw(1) };
    }
    return null;
  }

  function robotFaces(data, project) {
    const { x = 0, y = 0, angle = 0, fall = 0, height = 0, tilt = 0,
      ringOut = false, fallAxis = 0, fallTilt = 0, roll = 0, id, effect, effectProgress = 0 } = data;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const pitchSin = Math.sin(tilt);
    const pitchCos = Math.cos(tilt);
    const tiltSin = Math.sin(fallTilt);
    const tiltCos = Math.cos(fallTilt);
    const outwardX = Math.cos(fallAxis);
    const outwardY = Math.sin(fallAxis);
    const scale = 1.08;
    const rollSin = Math.sin(roll), rollCos = Math.cos(roll);
    const orient = ([a, side, up]) => {
      const b = side * rollCos - up * rollSin;
      const c = up * rollCos + side * rollSin;
      const front = a * pitchCos - c * pitchSin;
      return [front * cos - b * sin, front * sin + b * cos, c * pitchCos + a * pitchSin];
    };
    const rotate = ringOut ? point => {
      const [worldX, worldY, z] = orient(point);
      const towardEdge = worldX * outwardX + worldY * outwardY;
      const shift = towardEdge * (tiltCos - 1) + z * tiltSin;
      return [worldX + outwardX * shift, worldY + outwardY * shift, z * tiltCos - towardEdge * tiltSin];
    } : orient;
    const mesh = riggedMesh(id, effect);
    const parts = partTransforms(effect, effectProgress, data.bladeCharge);
    let base = height - fall;
    if ((ringOut && base < FLOOR_LEVEL + .95) || (!ringOut && roll !== 0)) {
      let lowest = Infinity;
      for (const face of mesh) {
        const pose = parts?.[face.part];
        for (const point of face.points) lowest = Math.min(lowest, rotate(pose ? pose(point, true) : point)[2] * scale);
      }
      // Keep the first corner that touches down above the floor as the body settles.
      base = Math.max(base, (ringOut ? FLOOR_LEVEL : 0) - lowest);
    }
    const faces = [];
    for (const face of mesh) {
      const pose = parts?.[face.part];
      const n = rotate(pose ? pose(face.normal, false) : face.normal);
      const facing = depth(n);
      if (facing <= 0) continue;
      const keyLight = Math.max(0, dot(n, KEY_LIGHT));
      const rimLight = Math.max(0, dot(n, RIM_LIGHT));
      const illumination = face.emissive ? 1.24 : .44 + keyLight * .72 + rimLight * .18 + facing * .08;
      faces.push({
        points: face.points.map(point => {
          const [a, b, c] = rotate(pose ? pose(point, true) : point);
          return depthPoint(project, [x + a * scale, y + b * scale, base + c * scale]);
        }),
        color: face.material.map(channel => Math.min(255, Math.round(channel * illumination))),
      });
    }
    return faces;
  }

  function depthPoint(project, world) {
    const [x, y] = project(world);
    return [x * ROBOT_SAMPLES, y * ROBOT_SAMPLES, depth(world)];
  }

  function deckDepth(points, project) {
    const cached = stageDepthFaces.get(project);
    if (cached?.points === points) return cached.faces;
    const top = points.map(([x, y]) => depthPoint(project, [x, y, 0]));
    const bottom = points.map(([x, y]) => depthPoint(project, [x, y, ARENA_BASE]));
    // All arena shapes are convex. A fan from an interior point keeps each
    // triangle's bounds small, so most triangles miss a small robot tile.
    const center = top.reduce(
      ([x, y, z], current) => [x + current[0], y + current[1], z + current[2]], [0, 0, 0]
    ).map(coordinate => coordinate / top.length);
    const faces = [];
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      faces.push({ points: [center, top[i], top[j]], color: null });
      if (points[j][0] < points[i][0]) {
        faces.push({ points: [top[i], top[j], bottom[j], bottom[i]], color: null });
      }
    }
    stageDepthFaces.set(project, { points, faces });
    return faces;
  }

  function faceBounds(faces) {
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const { points } of faces) {
      for (const [x, y] of points) {
        bounds.left = Math.min(bounds.left, Math.floor(x));
        bounds.top = Math.min(bounds.top, Math.floor(y));
        bounds.right = Math.max(bounds.right, Math.ceil(x));
        bounds.bottom = Math.max(bounds.bottom, Math.ceil(y));
      }
    }
    return bounds;
  }

  function rasterTriangle(a, b, c, tile, region, color) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const area = abx * acy - aby * acx;
    if (Math.abs(area) < 1e-6) return;

    const left = Math.max(region.left, Math.floor(Math.min(a[0], b[0], c[0])));
    const right = Math.min(region.right - 1, Math.floor(Math.max(a[0], b[0], c[0])));
    const top = Math.max(region.top, Math.floor(Math.min(a[1], b[1], c[1])));
    const bottom = Math.min(region.bottom - 1, Math.floor(Math.max(a[1], b[1], c[1])));
    if (right < left || bottom < top) return;
    const dBdx = acy / area;
    const dCdx = -aby / area;
    const dBdy = -acx / area;
    const dCdy = abx / area;
    const zB = b[2] - a[2];
    const zC = c[2] - a[2];
    const { width, data } = tile.pixels;
    const [r, g, bl] = color ?? [0, 0, 0];
    for (let y = top; y <= bottom; y++) {
      let wB = (left + .5 - a[0]) * dBdx + (y + .5 - a[1]) * dBdy;
      let wC = (left + .5 - a[0]) * dCdx + (y + .5 - a[1]) * dCdy;
      let index = (y - region.top) * width + left - region.left;
      for (let x = left; x <= right; x++, index++, wB += dBdx, wC += dCdx) {
        if (wB < -1e-6 || wC < -1e-6 || wB + wC > 1 + 1e-6) continue;
        const z = a[2] + wB * zB + wC * zC;
        if (z <= tile.depth[index]) continue;
        tile.depth[index] = z;
        // The platform is already painted on the main canvas. Only depth
        // goes into the robot tile so occluded pixels remain transparent.
        if (!color) continue;
        const pixel = index * 4;
        data[pixel] = r;
        data[pixel + 1] = g;
        data[pixel + 2] = bl;
        data[pixel + 3] = 255;
      }
    }
  }

  function paintTile(ctx, faces, bounds, occluders = []) {
    const alignStart = value => Math.floor(value / ROBOT_SAMPLES) * ROBOT_SAMPLES;
    const alignEnd = value => Math.ceil(value / ROBOT_SAMPLES) * ROBOT_SAMPLES;
    const region = {
      left: Math.max(0, alignStart(bounds.left)), top: Math.max(0, alignStart(bounds.top)),
      right: Math.min(ctx.canvas.width * ROBOT_SAMPLES, alignEnd(bounds.right)),
      bottom: Math.min(ctx.canvas.height * ROBOT_SAMPLES, alignEnd(bounds.bottom)),
    };
    const w = region.right - region.left;
    const h = region.bottom - region.top;
    if (w <= 0 || h <= 0) return;
    let tile = robotTiles.get(ctx);
    if (!tile) {
      const canvas = document.createElement("canvas");
      tile = { canvas, context: canvas.getContext("2d") };
      robotTiles.set(ctx, tile);
    }
    if (!tile.pixels || tile.pixels.width < w || tile.pixels.height < h) {
      tile.canvas.width = Math.max(tile.pixels?.width ?? 0, Math.ceil(w / 32) * 32);
      tile.canvas.height = Math.max(tile.pixels?.height ?? 0, Math.ceil(h / 32) * 32);
      tile.pixels = tile.context.createImageData(tile.canvas.width, tile.canvas.height);
      tile.depth = new Float32Array(tile.pixels.width * tile.pixels.height);
    }

    // The local depth buffer resolves intersecting panels and wheel meshes at each pixel.
    tile.depth.fill(-Infinity);
    tile.pixels.data.fill(0);
    for (const layer of [occluders, faces]) {
      for (const { points, color } of layer) {
        for (let i = 1; i < points.length - 1; i++) {
          rasterTriangle(points[0], points[i], points[i + 1], tile, region, color);
        }
      }
    }
    tile.context.putImageData(tile.pixels, 0, 0, 0, 0, w, h);
    ctx.drawImage(tile.canvas, 0, 0, w, h, region.left / ROBOT_SAMPLES, region.top / ROBOT_SAMPLES,
      w / ROBOT_SAMPLES, h / ROBOT_SAMPLES);
  }

  function paintRobots(ctx, robots, project, stagePoints) {
    const groups = robots.map(robot => {
      const faces = robotFaces(robot, project);
      return { faces, bounds: faceBounds(faces), ringOut: robot.ringOut };
    });
    const occluders = stagePoints && groups.some(group => group.ringOut) ? deckDepth(stagePoints, project) : [];
    if (groups.length === 2) {
      const [a, b] = groups.map(group => group.bounds);
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        paintTile(ctx, groups.flatMap(group => group.faces), {
          left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
          right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
        }, occluders);
        return;
      }
    }
    for (const { faces, bounds, ringOut } of groups) paintTile(ctx, faces, bounds, ringOut ? occluders : undefined);
  }

  function screen(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (width !== canvas.width) canvas.width = width;
    if (height !== canvas.height) canvas.height = height;
    return {
      ctx: canvas.getContext("2d"), w: width, h: height, dpr,
    };
  }

  function seeded(seed) {
    return () => {
      seed = (Math.imul(1664525, seed) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
  }

  function oval(ctx, x, y, rx, ry, paint, angle = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(.01, rx), Math.max(.01, ry), angle, 0, Math.PI * 2);
    ctx.fillStyle = paint;
    ctx.fill();
  }

  function haze(ctx, w, h, x, y, radius, color) {
    ctx.fillStyle = radial(ctx, w * x, h * y, radius, color, "#10151b00");
    ctx.fillRect(0, 0, w, h);
  }

  function floor(ctx, w, h, project, s, preview) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, preview ? "#202832" : "#0c1015");
    gradient.addColorStop(1, preview ? "#11151a" : "#161d25");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    if (preview) return;

    const right = w * .83;
    haze(ctx, w, h, .12, .26, w * .39, "#59251d50");
    haze(ctx, w, h, .87, .26, w * .39, "#1f497b60");
    haze(ctx, w, h, .52, .8, w * .46, "#36445138");

    for (let i = -20; i <= 20; i += 2) {
      const gridZ = FLOOR_LEVEL;
      stroke(ctx, [project([i, -26, gridZ]), project([i, 26, gridZ])], "#989ba00d", 1.2);
      stroke(ctx, [project([-32, i, gridZ]), project([32, i, gridZ])], "#989ba011", 1.2);
    }

    const beam = (x, mirror, color) => {
      const beamX = shift => x + shift * mirror;
      stroke(ctx, [[beamX(-s * .75), .09 * h], [beamX(0), .23 * h], [beamX(0), .28 * h]],
        "#323941", Math.max(1, s * .045));
      stroke(ctx, [[beamX(-s * .75), .105 * h], [beamX(-s * .15), .23 * h]],
        color, Math.max(1, s * .045));
      for (let i = 0; i < 4; i++) {
        const ix = beamX(-i * s * .20);
        stroke(ctx, [[ix - mirror * s * .15, .33 * h], [ix, .36 * h]], color, Math.max(1, s * .04));
      }
    };
    beam(w - right, 1, "#cd42315a");
    beam(right, -1, "#3183d067");

    const vignette = radial(ctx, w * .5, h * .54, Math.max(w, h) * .62, "#00000000", "#000000a3");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  function dimension(positions) {
    const xs = positions.map(p => p[0]);
    const ys = positions.map(p => p[1]);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }

  function paintStage(ctx, points, color, project, s, preview) {
    const top = points.map(([x, y]) => project([x, y, 0]));
    const lower = points.map(([x, y]) => project([x, y, ARENA_BASE]));
    const bounds = dimension(top);
    const x = (bounds.minX + bounds.maxX) / 2;
    const y = (bounds.minY + bounds.maxY) / 2;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    oval(ctx, x, y + s * .69, w * .59, h * .61,
      radial(ctx, x, y + s * .60, w * .59, "#000000b9", "#00000000"));
    ctx.save();
    ctx.shadowBlur = Math.max(8, s * .32);
    ctx.shadowColor = color + "73";
    stroke(ctx, lower, color + "45", Math.max(1.2, s * .035), true);
    ctx.restore();

    const sidePanels = points.map((p, i) => {
      const j = (i + 1) % points.length;
      const visible = points[j][0] < p[0];
      return { i, j, visible };
    }).filter(panel => panel.visible);
    const wallPaint = ctx.createLinearGradient(0, bounds.minY, 0, bounds.maxY + s * .82);
    wallPaint.addColorStop(0, "#3e4650");
    wallPaint.addColorStop(.62, "#20252c");
    wallPaint.addColorStop(1, "#080c11");

    for (const { i, j } of sidePanels) fill(ctx, [top[i], top[j], lower[j], lower[i]], wallPaint);
    ctx.save();
    for (const { i, j } of sidePanels) {
      ctx.lineWidth = Math.max(1, s * .02);
      ctx.strokeStyle = wallPaint;
      path(ctx, [top[i], top[j], lower[j], lower[i]]);
      ctx.stroke();
    }
    ctx.restore();

    const deck = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
    deck.addColorStop(0, "#3b424a");
    deck.addColorStop(.55, "#2a3038");
    deck.addColorStop(1, "#252930");
    fill(ctx, top, deck);
    ctx.save();
    path(ctx, top);
    ctx.clip();
    const random = seeded(295847);
    const sparks = Math.floor(Math.min(3600, 360 + w * h / 90));
    for (let i = 0; i < sparks; i++) {
      const px = bounds.minX + w * random();
      const py = bounds.minY + h * random();
      const length = (random() ** 3) * s * .28 + .6;
      ctx.fillStyle = i % 3 === 0 ? "#e1eff719" : "#070a101e";
      ctx.fillRect(px, py, length, Math.max(.7, s * .009));
    }
    for (const row of [-4, -2, 0, 2, 4]) {
      stroke(ctx, [project([-10, row, 0]), project([10, row, 0])], "#191f2555", Math.max(.8, s * .015));
      stroke(ctx, [project([row, -10, 0]), project([row, 10, 0])], "#191f2555", Math.max(.8, s * .015));
    }
    stroke(ctx, points.map(point => project([...scaleAboutCenter(point, .949), 0])),
      "#c1cedc28", Math.max(.7, s * .018), true);
    ctx.fillStyle = radial(ctx, x, y, w * .57, "#afc4d220", "#161f2200");
    ctx.fillRect(bounds.minX, bounds.minY, w, h);
    const ring = Array.from({ length: 56 }, (_, i) =>
      project([Math.cos(i * Math.PI / 28) * 1.15, Math.sin(i * Math.PI / 28) * 1.15, 0]));
    stroke(ctx, ring, "#a5b2c021", Math.max(.7, s * .020), true);
    for (const sign of [-1, 1]) {
      const mid = sign * 2.5;
      const barra = [[mid - .063, -.52], [mid + .063, -.52], [mid + .063, .52], [mid - .063, .52]];
      fill(ctx, barra.map(p => project([...p, 0])), TEAM[Number(sign > 0)] + (preview ? "de" : "85"));
    }
    ctx.restore();

    const colorWidth = Math.max(1.4, s * .050);
    ctx.save();
    ctx.shadowBlur = Math.max(2, s * .17);
    ctx.shadowColor = color;
    stroke(ctx, top, color, colorWidth, true);
    ctx.restore();
    stroke(ctx, top, "#ffffff42", Math.max(.65, colorWidth * .28), true);
  }

  function stage(canvas, w, h, setup, preview) {
    const { points, color = "#ff5246", id = "circle" } = setup;
    const key = `${id}/${w}/${h}/${preview}`;
    const cached = stages.get(canvas);
    if (cached?.key === key) return cached;
    const buffer = document.createElement("canvas");
    buffer.width = w;
    buffer.height = h;
    const { minX, maxX, minY, maxY } = dimension(points);
    const rangeX = Math.max(.1, maxX - minX);
    const rangeY = Math.max(.1, (maxY - minY) * FIELD_Y);
    const s = Math.min(w * .94 / rangeX,
      h * (preview ? .94 : .97) / (rangeY + (preview ? .86 : 1.45)));
    const cx = (w - s * (minX + maxX)) / 2;
    const cy = (preview ? .47 : .49) * h - s * (minY + maxY) * FIELD_Y / 2;
    const project = ([x, y, z = 0]) => [cx + s * x, cy + s * (y * FIELD_Y - z * HEIGHT_Y)];
    const ctx = buffer.getContext("2d");
    floor(ctx, w, h, project, s, preview);
    const deck = document.createElement("canvas");
    deck.width = w;
    deck.height = h;
    paintStage(deck.getContext("2d"), points, color, project, s, preview);
    const bounds = dimension(points.flatMap(([x, y]) => [project([x, y, 0]), project([x, y, ARENA_BASE])]));
    const result = { key, buffer, deck, project, s, bounds };
    stages.set(canvas, result);
    return result;
  }

  function shadow(ctx, x, y, s, opacity = 1) {
    const gradient = radial(ctx, x, y, s * .89, "#050608af", "#03050900");
    ctx.save();
    ctx.globalAlpha *= opacity;
    oval(ctx, x, y + s * .07, s * .92, s * .48, gradient);
    ctx.restore();
  }

  const fallCameras = new WeakMap();
  const LIGHTNING_AIR = new Set(["lightning-rise", "lightning-hover", "lightning-slam"]);

  function frameFall(canvas, scenery, bots, w, h) {
    const falling = bots.filter(bot => bot.ringOut);
    const aerial = bots.filter(bot => !bot.ringOut && (bot.height >= 1 || LIGHTNING_AIR.has(bot.effect)));
    const previous = fallCameras.get(canvas);
    const recoveringAir = previous?.key === scenery.key && previous.aerial;
    if (!falling.length && !aerial.length && !recoveringAir) {
      fallCameras.delete(canvas);
      return { zoom: 1, x: 0, y: 0, project: scenery.project, s: scenery.s };
    }
    const now = performance.now();
    const prior = previous?.key === scenery.key ? previous : { zoom: 1, x: 0, y: 0, now: now - 16 };
    const bounds = { ...scenery.bounds };
    // Reserve room below and beyond the ledge early, before the fall reaches the floor.
    const safe = { ...bounds };
    const radius = scenery.s * 1.05;
    const include = (box, px, py) => {
      box.minX = Math.min(box.minX, px - radius);
      box.maxX = Math.max(box.maxX, px + radius);
      box.minY = Math.min(box.minY, py - radius);
      box.maxY = Math.max(box.maxY, py + radius * .80);
    };
    for (const bot of falling) {
      include(safe, ...scenery.project([bot.x, bot.y, (bot.height || 0) - (bot.fall || 0)]));
      const lead = bot.landed ? 0 : .5;
      const angle = bot.fallAxis ?? 0;
      include(bounds, ...scenery.project([
        bot.x + Math.cos(angle) * lead, bot.y + Math.sin(angle) * lead, FLOOR_LEVEL
      ]));
    }
    for (const bot of aerial) {
      const height = bot.height || 0;
      include(safe, ...scenery.project([bot.x, bot.y, height + .34]));
      const forecast = bot.effect === "lightning-rise" || bot.effect === "lightning-hover" ? 3 : height;
      include(bounds, ...scenery.project([bot.x, bot.y, forecast + .34]));
    }
    const inset = Math.min(w, h) * .025;
    const scaleToFit = box => Math.min(1,
      (w - inset * 2) / (box.maxX - box.minX), (h - inset * 2) / (box.maxY - box.minY));
    const clamp = (n, low, high) => Math.min(Math.max(n, low), high);
    const position = (size, min, max, zoom, ideal) =>
      clamp(ideal, inset - min * zoom, size - inset - max * zoom);
    const target = scaleToFit(bounds);
    const mix = 1 - Math.exp(-Math.max(0, now - prior.now) / 85);
    const zoom = Math.min(scaleToFit(safe), prior.zoom + (target - prior.zoom) * mix);
    const goalX = position(w, bounds.minX, bounds.maxX, target, (1 - target) * w / 2);
    const goalY = !falling.length && !aerial.length ? 0 :
      position(h, bounds.minY, bounds.maxY, target, (1 - target) * h / 2);
    const x = position(w, safe.minX, safe.maxX, zoom, prior.x + (goalX - prior.x) * mix);
    const y = position(h, safe.minY, safe.maxY, zoom, prior.y + (goalY - prior.y) * mix);
    const aerialCamera = aerial.length > 0 ||
      (recoveringAir && (1 - zoom > .002 || Math.abs(x) + Math.abs(y) > 1));
    fallCameras.set(canvas, { key: scenery.key, zoom, x, y, now, aerial: aerialCamera });
    return {
      zoom, x, y, s: scenery.s * zoom,
      project(point) {
        const [px, py] = scenery.project(point);
        return [x + px * zoom, y + py * zoom];
      }
    };
  }

  function marker(ctx, project, fighter, index, s) {
    const p = project([fighter.x, fighter.y, .79 + (fighter.height || 0)]);
    const color = TEAM[index];
    const height = Math.max(17, s * .26);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(p[0] - .56 * height, p[1] - height, 1.12 * height, height, height * .19);
    else ctx.rect(p[0] - .56 * height, p[1] - height, 1.12 * height, height);
    ctx.fill();
    ctx.font = `800 ${height * .69}px "Arial Narrow", system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(index === 0 ? "A" : "B", p[0], p[1] - height * .53);
  }

  function localProject(project, x, y, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return ([u, v, z]) => project([x + u * cos - v * sin, y + u * sin + v * cos, z]);
  }

  // The warning follows Lightning's chassis footprint in game.cjs.
  const LIGHTNING_HULL_HALF = [
    [-.814, -.360], [-.770, -.537], [-.639, -.577], [-.576, -.592],
    [.447, -.592], [.510, -.577], [.640, -.537], [.896, -.146]
  ];
  const LIGHTNING_HULL = [...LIGHTNING_HULL_HALF,
    ...LIGHTNING_HULL_HALF.slice().reverse().map(([x, y]) => [x, -y])];

  function arc(ctx, x, y, radius, start, end, width, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * FIELD_Y, 0, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function landingGlyph(ctx, at, s, progress, impact = false) {
    const outline = LIGHTNING_HULL.map(([x, y]) => at([x, y, .009]));
    fill(ctx, outline, impact ? "#fff5a97a" : "#fa94235b");
    stroke(ctx, outline, "#211204ca", Math.max(3, s * .059), true);
    stroke(ctx, outline, impact ? "#fff5a9" : "#ffce62", Math.max(1.5, s * .025), true);
    for (let i = 0; i < 5; i++) {
      const u = -.58 + i * .24;
      stroke(ctx, [[u, -.24], [u + .065, 0], [u, .24]].map(([x, y]) => at([x, y, .01])),
        i < Math.ceil(progress * 5) ? "#fff2b7" : "#ffcd63a0", Math.max(1.5, s * .027));
    }
  }

  function thrust(ctx, at, s, color, dual, now, surge = 1) {
    for (const side of dual ? [-.29, .29] : [0]) {
      const jets = .8 + .16 * Math.sin(now / 35 + side * 8);
      const rear = dual ? -.69 : -.52;
      fill(ctx, [[rear, side + .096, .21], [rear - jets * surge, side, .12],
        [rear, side - .096, .21]].map(at), color + "86");
      stroke(ctx, [at([rear, side, .21]), at([rear - jets * surge * .66, side, .12])],
        "#fff4ca", Math.max(1.4, s * .031));
    }
  }

  function abilityFx(ctx, project, fighter, s, now, points) {
    const { effect, effectProgress: progress = 0, height = 0 } = fighter;
    if (fighter.ringOut || (!effect && !fighter.carried && !fighter.boosting)) return;
    const at = localProject(project, fighter.x, fighter.y, fighter.angle);
    const [x, y] = at([0, 0, .009]);
    ctx.save();
    if (fighter.carried) {
      const center = at([0, 0, height * .7]);
      arc(ctx, ...center, s * .75, 0, Math.PI * 2, Math.max(1.6, s * .027), "#76ffd4aa");
    }
    if (fighter.boosting && effect !== "lightning-boost") {
      thrust(ctx, ([u, v, z]) => at([u, v, height + z]), s, "#ffc459", true, now, 1.45);
    }
    switch (effect) {
      case "ult-prep": {
        const color = TEAM[fighter.index];
        const pulse = .95 + Math.sin(now / 120) * .05;
        arc(ctx, x, y, s * pulse, 0, Math.PI * 2, Math.max(2, s * .045), color + "75");
        arc(ctx, x, y, s * pulse, -Math.PI / 2, Math.PI * (progress * 2 - .5),
          Math.max(2, s * .052), "#fff2ac");
        break;
      }
      case "wedge-dash":
      case "wedge-surge":
        thrust(ctx, at, s, "#ff754b", false, now, effect === "wedge-surge" ? 1.45 : 1);
        break;
      case "iron-spikes":
        ctx.globalAlpha = .6 + .4 * Math.sin(now / 138) ** 2;
        for (const side of [-.36, -.12, .12, .36]) {
          stroke(ctx, [[.664, side, .27], [.735, side, .234]].map(at), "#c7efff", Math.max(1, s * .014));
        }
        break;
      case "iron-drill":
        thrust(ctx, at, s, "#75bdff", true, now, 1.38);
        for (const side of [-.53, .53]) {
          stroke(ctx, [[-.30, side, .20], [.58, side, .23], [.82, side * .81, .19]].map(at),
            "#afdfff", Math.max(2, s * .037));
        }
        break;
      case "lightning-boost":
        thrust(ctx, ([u, v, z]) => at([u, v, height + z]), s, "#ffc459", true, now, 1.45);
        break;
      case "lightning-rise":
      case "lightning-hover":
      case "lightning-slam": {
        ctx.save();
        path(ctx, points.map(([x, y]) => project([x, y, .009])));
        ctx.clip();
        landingGlyph(ctx, at, s, effect === "lightning-hover" ? progress : 1);
        ctx.restore();
        if (height > .08) {
          const l = at([-.35, 0, .02]), r = at([.35, 0, .02]);
          const skyL = at([-.21, 0, height]), skyR = at([.21, 0, height]);
          const beam = ctx.createLinearGradient(l[0], l[1], skyL[0], skyL[1]);
          beam.addColorStop(0, "#ffc95248");
          beam.addColorStop(1, "#fff0a767");
          fill(ctx, [l, r, skyR, skyL], beam);
          const streak = [[-.18, 0, height * .99], [.07, 0, height * .76], [-.08, 0, height * .67],
            [.12, 0, height * .43], [-.02, 0, height * .29], [.14, 0, .025]].map(at);
          stroke(ctx, streak, "#ffdf876e", Math.max(2, s * .035));
          if (effect === "lightning-rise" && !fighter.boosting) {
            thrust(ctx, ([u, v, z]) => at([u, v, height + z]), s, "#ffd273", true, now, .72);
          }
        }
        break;
      }
      case "spin-charge": {
        const charge = Math.max(0, Math.min(1, fighter.bladeCharge ?? progress));
        const width = Math.max(1.6, s * .032);
        const radius = s * (.7 + .2 * charge);
        const center = at([0, 0, .25]);
        arc(ctx, ...center, radius, 0, Math.PI * 2, width, "#792ec699");
        arc(ctx, ...center, radius, -Math.PI / 2, Math.PI * (2 * charge - .5), width * 1.4, "#dd9dff");
        if (charge > 0) {
          const phase = fighter.angle + now / 180;
          for (let i = 0; i < 3; i++) {
            const spin = phase + i * Math.PI * 2 / 3;
            arc(ctx, ...center, radius, spin, spin + .72 * charge,
              Math.max(1.2, s * (.012 + .022 * charge)), "#71fcf7");
          }
        }
        break;
      }
      case "spin-blade":
      case "spin-ult": {
        const blade = effect === "spin-blade";
        const phase = fighter.angle + now / (blade ? 180 : 85);
        const radius = s * (blade ? .90 : 1.06);
        const center = at([0, 0, blade ? .25 : .075]);
        arc(ctx, ...center, radius, 0, Math.PI * 2, Math.max(3, s * .075), "#48daed39");
        for (let i = 0; i < 3; i++) {
          const spin = phase + i * Math.PI * 2 / 3;
          arc(ctx, ...center, radius, spin, spin + .72, Math.max(2, s * .034), blade ? "#71fcf7" : "#c0d8ff");
        }
        break;
      }
      case "grapple-grab":
      case "grapple-carry":
      case "grapple-toss":
        stroke(ctx, [at([.77, -.26, .29]), at([.77, .26, .29])], "#5cfdd777", Math.max(1.2, s * .02));
        break;
      case "flip-scoop":
      case "flip-overturn":
        stroke(ctx, [[.55, -.42, .10], [.88, 0, .12], [.55, .42, .10]].map(at),
          effect === "flip-overturn" ? "#fff1af" : "#ffb770", Math.max(2, s * .031));
        break;
      default:
        break;
    }
    ctx.restore();
  }

  function paintImpact(canvas, ctx, project, impact, s) {
    if (!impact) return;
    const now = performance.now();
    const current = impacts.get(canvas);
    const newEvent = !current || current.id !== impact.id;
    const event = newEvent ? { id: impact.id, start: now } : current;
    if (newEvent) impacts.set(canvas, event);
    const t = (now - event.start) / 370;
    if (t < 0 || t >= 1) return;
    const [x, y] = project([impact.x, impact.y, .17]);
    if (impact.kind === "lightning-slam") {
      ctx.save();
      ctx.globalAlpha = 1 - t;
      landingGlyph(ctx, localProject(project, impact.x, impact.y, impact.angle ?? 0), s, 1, true);
      arc(ctx, x, y, s * (.68 + .86 * t), 0, Math.PI * 2, Math.max(2, s * .048), "#ffe28f");
      ctx.restore();
    }
    const random = seeded(934 + Number(impact.id || 0));
    const strength = .55 + Math.min(17, impact.power || 0) * .055;
    for (let i = 0; i < 21; i++) {
      const a = random() * 2 * Math.PI;
      const r = (.13 + random() * .96) * s * strength * (.18 + .85 * t);
      const tx = x + r * Math.cos(a);
      const ty = y + r * Math.sin(a) * .65 - s * .26 * t;
      ctx.globalAlpha = 1 - t;
      stroke(ctx, [[tx, ty], [tx + Math.cos(a) * s * .11, ty + Math.sin(a) * s * .09]],
        i % 4 === 0 ? "#ffffd3" : "#ffc264", Math.max(1, s * .022));
    }
    ctx.globalAlpha = 1;
  }

  function trackMotion(canvas, fighters, phase) {
    const now = performance.now();
    const previous = motion.get(canvas);
    const continuous = previous?.phase === phase && (phase === "live" ||
      (phase !== "paused" && phase !== "countdown" && fighters.some(fighter => fighter.ringOut)));
    const mix = continuous ? 1 - Math.exp(-(now - previous.now) / 22) : 1;
    const bots = fighters.map((fighter, index) => {
      const prior = previous?.bots[index];
      const next = { ...fighter, index };
      if (!prior || mix === 1) return next;
      for (const field of ["x", "y", "height", "fall", "tilt", "fallTilt", "roll"]) {
        const start = prior[field] || 0;
        next[field] = start + ((fighter[field] || 0) - start) * mix;
      }
      const turn = fighter.angle - prior.angle;
      next.angle = prior.angle + Math.atan2(Math.sin(turn), Math.cos(turn)) * mix;
      if (fighter.effect && fighter.effect === prior.effect) {
        const start = prior.effectProgress || 0;
        next.effectProgress = start + ((fighter.effectProgress || 0) - start) * mix;
      }
      if (Number.isFinite(fighter.bladeCharge)) {
        const start = Number.isFinite(prior.bladeCharge) ? prior.bladeCharge : fighter.bladeCharge;
        next.bladeCharge = start + (fighter.bladeCharge - start) * mix;
      }
      return next;
    });
    motion.set(canvas, { bots, phase, now });
    return bots;
  }

  function arena(canvas, { arena: configuration, fighters = [], phase, winner, showcase, impact, preview = false }) {
    const target = screen(canvas);
    if (!target || !configuration?.points?.length) return;
    const { ctx, w, h } = target;
    const scenery = stage(canvas, w, h, configuration, preview);
    ctx.drawImage(scenery.buffer, 0, 0);
    if (preview) {
      ctx.drawImage(scenery.deck, 0, 0);
      return;
    }

    const final = phase === "final" && showcase !== false;
    let bots = trackMotion(canvas, fighters, phase);
    const winnerIndex = typeof winner === "number" ? winner : ["A", "B"].indexOf(winner);
    if (final && bots[winnerIndex]) {
      bots = [{ ...bots[winnerIndex], x: 0, y: .6, fall: 0, ringOut: false,
        fallAxis: null, fallTilt: 0, height: 0, tilt: 0, roll: 0, angle: .75, effect: null, carried: false }];
    }
    const frame = frameFall(canvas, scenery, bots, w, h);
    const { project, s } = frame;
    for (const robot of bots) {
      if (!robot.ringOut) continue;
      const elevation = Math.max(0, (robot.height || 0) - (robot.fall || 0) - FLOOR_LEVEL);
      const [x, y] = project([robot.x, robot.y, FLOOR_LEVEL]);
      shadow(ctx, x, y, s * (1 + elevation * .13), 1 / (1 + elevation));
    }
    ctx.drawImage(scenery.deck, frame.x, frame.y, w * frame.zoom, h * frame.zoom);
    if (final && bots.length === 1) {
      const [x, y] = project([0, .6, .16]);
      ctx.fillStyle = radial(ctx, x, y, s * 4.0, "#ffb34e37", "#ffc18600");
      ctx.fillRect(0, 0, w, h);
    }
    for (const robot of bots) {
      if (robot.ringOut) continue;
      const [x, y] = project([robot.x, robot.y, 0]);
      const elevation = Math.max(0, robot.height || 0);
      shadow(ctx, x, y, s * (1 + elevation * .13), 1 / (1 + elevation));
    }
    if (!final) {
      const now = performance.now();
      for (const robot of bots) abilityFx(ctx, project, robot, s, now, configuration.points);
    }
    paintRobots(ctx, bots, project, configuration.points);
    if (!final) {
      for (const robot of bots) {
        if (!robot.ringOut) marker(ctx, project, robot, robot.index, s);
      }
      paintImpact(canvas, ctx, project, impact, s);
    }
  }

  function robot(canvas, { id, angle = .9 } = {}) {
    const target = screen(canvas);
    if (!target) return;
    const { ctx, w, h } = target;
    const s = Math.min(w * .53, h * 1.06);
    const x = w * .50;
    const y = h * .60;
    const project = ([a, b, c]) => [x + s * a, y + s * (b * FIELD_Y - c * HEIGHT_Y)];
    ctx.clearRect(0, 0, w, h);
    haze(ctx, w, h, .50, .58, Math.min(w, h) * .75, (MODELS[id] || MODELS.wedge) + "40");
    shadow(ctx, x, y, s);
    paintRobots(ctx, [{ id, angle }], project);
  }

  window.SumoRender = { arena, robot, icon: id => ICONS[id] || "○" };
})();
