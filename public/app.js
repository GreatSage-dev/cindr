import * as THREE from '/vendor/three.module.js';

document.documentElement.classList.add('js-motion');

const HERO_STATES = [
  {
    key: 'a',
    counter: '001 / 002',
    edgeTag: '00.00',
    headline:
      '<span class="hl-line hl-indent-1">5 Loose</span><span class="hl-line">Stamps</span><span class="hl-line hl-italic">into</span><span class="hl-line hl-indent-2">1 cindr</span><span class="hl-line hl-indent-3">Trophy</span>',
    lead: 'Burn 5, 9, or 10 TokenHunt CashTokens in 1 Layla loop transaction to mint a verified Trophy NFT with 0 block delay.',
  },
  {
    key: 'b',
    counter: '002 / 002',
    edgeTag: '01.00',
    headline:
      '<span class="hl-line hl-indent-1">Burn 5</span><span class="hl-line">in 1 Loop</span><span class="hl-line hl-italic">with</span><span class="hl-line hl-indent-2">0 Block</span><span class="hl-line hl-indent-3">Delay</span>',
    lead: 'Output 0 keeps the minting baton warm in mempool while Output 2 enforces 0 remaining stamp tokens at consensus level.',
  },
];

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function createSeededRng(seed = 1337) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Unit closed cylinder + 2-ring domed end-cap base geometry for instanced optical cables.
 */
function createRodBaseGeometry(radialSegs = 14, lengthSegs = 22) {
  const positions = [];
  const aT = [];
  const aPhi = [];
  const aCapR = [];
  const indices = [];

  const ringStride = radialSegs + 1;

  // Cylindrical shaft rings (j = 0..lengthSegs)
  for (let j = 0; j <= lengthSegs; j++) {
    const t = j / lengthSegs;
    for (let i = 0; i <= radialSegs; i++) {
      const phi = (i / radialSegs) * Math.PI * 2;
      positions.push(Math.cos(phi), Math.sin(phi), t);
      aT.push(t);
      aPhi.push(phi);
      aCapR.push(-1.0);
    }
  }

  for (let j = 0; j < lengthSegs; j++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = j * ringStride + i;
      const b = a + 1;
      const c = a + ringStride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  // Circular domed end-cap at t = 1.0: outer ring (1.0), mid ring (0.65), center apex (0.0)
  const capOuterStart = positions.length / 3;
  for (const capRadius of [1.0, 0.65]) {
    for (let i = 0; i <= radialSegs; i++) {
      const phi = (i / radialSegs) * Math.PI * 2;
      positions.push(Math.cos(phi) * capRadius, Math.sin(phi) * capRadius, 1.0);
      aT.push(1.0);
      aPhi.push(phi);
      aCapR.push(capRadius);
    }
  }

  const capCenterIdx = positions.length / 3;
  positions.push(0, 0, 1.0);
  aT.push(1.0);
  aPhi.push(0.0);
  aCapR.push(0.0);

  for (let i = 0; i < radialSegs; i++) {
    const outerA = capOuterStart + i;
    const outerB = outerA + 1;
    const midA = capOuterStart + ringStride + i;
    const midB = midA + 1;
    indices.push(outerA, outerB, midA, outerB, midB, midA);
    indices.push(midA, midB, capCenterIdx);
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  geo.setAttribute('aPhi', new THREE.Float32BufferAttribute(aPhi, 1));
  geo.setAttribute('aCapR', new THREE.Float32BufferAttribute(aCapR, 1));
  return geo;
}

/**
 * Generates 58 non-overlapping 3D optical glass rod control points (46 main bundle + 12 lower-left stragglers).
 */
function buildOpticalRodLayout(rng) {
  const MAIN_COUNT = 46;
  const STRAGGLER_COUNT = 12;
  const TOTAL = MAIN_COUNT + STRAGGLER_COUNT;
  const rods = [];

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  // Main dense golden-tip bundle compactly centered slightly right of center
  for (let i = 0; i < MAIN_COUNT; i++) {
    const frac = (i + 0.5) / MAIN_COUNT;
    const dist = Math.sqrt(frac);
    const theta = i * goldenAngle + (rng() - 0.5) * 0.18;
    const tipX = 0.22 + Math.cos(theta) * dist * 0.40;
    const tipY = -0.04 + Math.sin(theta) * dist * 0.27;
    const tipZ = 1.56 - dist * 0.52;
    const radius = 0.06 + (1 - dist * 0.35) * 0.015 + rng() * 0.005;
    rods.push({
      tipX,
      tipY,
      tipZ,
      radius,
      seed: rng(),
      tone: frac > 0.46 && Math.sin(theta) > -0.1 ? 0.68 + rng() * 0.32 : rng() * 0.42,
      angle: theta,
      group: 'main',
    });
  }

  // Asymmetric lower-left fan stragglers staying well above bottom controls
  for (let i = 0; i < STRAGGLER_COUNT; i++) {
    const col = i / (STRAGGLER_COUNT - 1);
    const tipX = -0.34 + col * 0.44 + (rng() - 0.5) * 0.04;
    const tipY = -0.74 + Math.abs(col - 0.35) * 0.3 + (rng() - 0.5) * 0.05;
    const tipZ = 0.66 + col * 0.24;
    const radius = 0.056 + rng() * 0.011;
    rods.push({
      tipX,
      tipY,
      tipZ,
      radius,
      seed: rng(),
      tone: rng() * 0.32,
      angle: -2.1 + col * 1.0,
      group: 'straggler',
    });
  }

  // 24-iteration 2D tip relaxation pass so circular glowing faces pack tightly without intersection
  for (let iter = 0; iter < 24; iter++) {
    for (let i = 0; i < TOTAL; i++) {
      for (let j = i + 1; j < TOTAL; j++) {
        const a = rods[i];
        const b = rods[j];
        const sameGroup = a.group === b.group;
        const dx = b.tipX - a.tipX;
        const dy = b.tipY - a.tipY;
        const distSq = dx * dx + dy * dy + 1e-6;
        const minDist = (a.radius + b.radius) * (sameGroup ? 2.04 : 1.9);
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const push = (minDist - dist) * 0.42;
          const nx = dx / dist;
          const ny = dy / dist;
          a.tipX -= nx * push;
          a.tipY -= ny * push;
          b.tipX += nx * push;
          b.tipY += ny * push;
        }
      }
      if (rods[i].group === 'straggler') {
        rods[i].tipX = Math.max(-0.36, Math.min(0.18, rods[i].tipX));
        rods[i].tipY = Math.max(-0.80, Math.min(-0.34, rods[i].tipY));
      } else {
        rods[i].tipX = Math.max(-0.22, Math.min(0.68, rods[i].tipX));
        rods[i].tipY = Math.max(-0.42, Math.min(0.32, rods[i].tipY));
      }
    }
  }

  const aRoot = new Float32Array(TOTAL * 3);
  const aCtrl1 = new Float32Array(TOTAL * 3);
  const aCtrl2 = new Float32Array(TOTAL * 3);
  const aTip = new Float32Array(TOTAL * 3);
  const aRadius = new Float32Array(TOTAL);
  const aSeed = new Float32Array(TOTAL);
  const aTone = new Float32Array(TOTAL);
  const aAngle = new Float32Array(TOTAL);

  for (let i = 0; i < TOTAL; i++) {
    const r = rods[i];
    // Monotonic parallel offsets prevent shafts from intersecting each other mid-barrel
    const spreadX = (r.tipX - 0.16) * 0.68;
    const spreadZ = (r.tipZ - 1.2) * 0.68;
    const rootX = -0.82 + spreadX;
    const rootY = 2.66 + (r.tipY + 0.12) * 0.42;
    const rootZ = -1.78 + spreadZ;

    const c1X = -0.34 + spreadX * 0.85;
    const c1Y = 1.44 + (r.tipY + 0.1) * 0.48;
    const c1Z = -0.62 + spreadZ * 0.82;

    // Gentle curve toward camera (+Z) so circular glowing faces read clearly without crossing shafts
    const c2X = r.tipX - 0.18;
    const c2Y = r.tipY + 0.36;
    const c2Z = r.tipZ - 0.68;

    aRoot.set([rootX, rootY, rootZ], i * 3);
    aCtrl1.set([c1X, c1Y, c1Z], i * 3);
    aCtrl2.set([c2X, c2Y, c2Z], i * 3);
    aTip.set([r.tipX, r.tipY, r.tipZ], i * 3);

    aRadius[i] = r.radius;
    aSeed[i] = r.seed;
    aTone[i] = r.tone;
    aAngle[i] = r.angle;
  }

  return {
    count: TOTAL,
    rods,
    aRoot,
    aCtrl1,
    aCtrl2,
    aTip,
    aRadius,
    aSeed,
    aTone,
    aAngle,
  };
}

/**
 * Builds and manages the Two-Layer Three.js Scene:
 * Layer 1 (State A): 58 closed 3D optical glass rods with glowing circular faces + micro-bokeh.
 * Layer 2 (State B): 1,500 back-to-front sorted tufted golden iris crown strands + 18 silver radial rays.
 * Pauses automatically via IntersectionObserver when #hero-stage leaves the viewport.
 */
function initIrisScene({ onMorphChange }) {
  const heroStage = document.getElementById('hero-stage');
  const heroCard = document.getElementById('hero-card');
  const canvas = document.getElementById('iris-canvas');
  if (!canvas || !heroCard || !heroStage) return null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    heroCard.classList.add('has-no-webgl');
    return null;
  }

  const gl = renderer.getContext();
  if (!gl) {
    heroCard.classList.add('has-no-webgl');
    return null;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  camera.position.set(0, 0, 5.4);

  const rootGroup = new THREE.Group();
  scene.add(rootGroup);

  const rng = createSeededRng(202605);
  const sharedUniforms = {
    uTime: { value: 0 },
    uMorph: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
  };

  // ---------------------------------------------------------------------------
  // LAYER 1: 58 True 3D Cylindrical Optical Glass Cables + Glowing End-Caps (State A)
  // ---------------------------------------------------------------------------
  const rodLayout = buildOpticalRodLayout(rng);
  const rodGeo = createRodBaseGeometry(14, 22);
  rodGeo.instanceCount = rodLayout.count;
  rodGeo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(rodLayout.aRoot, 3));
  rodGeo.setAttribute('aCtrl1', new THREE.InstancedBufferAttribute(rodLayout.aCtrl1, 3));
  rodGeo.setAttribute('aCtrl2', new THREE.InstancedBufferAttribute(rodLayout.aCtrl2, 3));
  rodGeo.setAttribute('aTip', new THREE.InstancedBufferAttribute(rodLayout.aTip, 3));
  rodGeo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(rodLayout.aRadius, 1));
  rodGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(rodLayout.aSeed, 1));
  rodGeo.setAttribute('aTone', new THREE.InstancedBufferAttribute(rodLayout.aTone, 1));
  rodGeo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(rodLayout.aAngle, 1));

  const rodMaterial = new THREE.ShaderMaterial({
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aT;
      attribute float aPhi;
      attribute float aCapR;
      attribute vec3 aRoot;
      attribute vec3 aCtrl1;
      attribute vec3 aCtrl2;
      attribute vec3 aTip;
      attribute float aRadius;
      attribute float aSeed;
      attribute float aTone;
      attribute float aAngle;

      uniform float uTime;
      uniform float uMorph;

      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vT;
      varying float vCapR;
      varying float vSeed;
      varying float vTone;
      varying float vMorph;

      vec3 cubicBezier(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
        float u = 1.0 - t;
        return u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;
      }

      void main() {
        vT = aT;
        vCapR = aCapR;
        vSeed = aSeed;
        vTone = aTone;

        float m = clamp(uMorph * 1.45, 0.0, 1.0);
        m = m * m * (3.0 - 2.0 * m);
        vMorph = m;

        // Subtle organic idle motion in State A
        vec3 swayOffset = vec3(
          sin(uTime * 0.95 + aSeed * 11.0 + aT * 2.5) * 0.018 * aT,
          cos(uTime * 0.8 + aSeed * 8.5 + aT * 2.0) * 0.014 * aT,
          0.0
        );

        // Morph flare: cables splay radially outward and taper off as iris bursts in
        vec3 flareOffset = vec3(cos(aAngle), sin(aAngle), 0.35) * (0.85 * m * m * aT);

        vec3 centerPos = cubicBezier(aRoot, aCtrl1, aCtrl2, aTip, aT) + swayOffset + flareOffset;
        vec3 nearPos = (aT < 0.98)
          ? cubicBezier(aRoot, aCtrl1, aCtrl2, aTip, min(aT + 0.018, 1.0)) + swayOffset + flareOffset
          : cubicBezier(aRoot, aCtrl1, aCtrl2, aTip, max(aT - 0.018, 0.0)) + swayOffset + flareOffset;

        vec3 T = (aT < 0.98)
          ? normalize(nearPos - centerPos)
          : normalize(centerPos - nearPos);

        vec3 refUp = (abs(T.y) < 0.92) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 N = normalize(cross(T, refUp));
        vec3 B = cross(T, N);
        vec3 radialDir = cos(aPhi) * N + sin(aPhi) * B;

        float r = aRadius * mix(1.0, 0.25, m);
        vec3 worldLocalPos;
        vec3 localNormal;

        if (aCapR < 0.0) {
          worldLocalPos = centerPos + radialDir * r;
          localNormal = radialDir;
        } else {
          float domeLift = (1.0 - aCapR * aCapR) * r * 0.34;
          worldLocalPos = centerPos + radialDir * (r * aCapR) + T * domeLift;
          localNormal = normalize(radialDir * (aCapR * 0.72) + T * 0.86);
        }

        vec4 mvPosition = modelViewMatrix * vec4(worldLocalPos, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        vNormal = normalize(normalMatrix * localNormal);

        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vT;
      varying float vCapR;
      varying float vSeed;
      varying float vTone;
      varying float vMorph;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);
        float ndotv = abs(dot(N, V));
        float fresnel = pow(1.0 - clamp(ndotv, 0.0, 1.0), 2.3);

        vec3 studioLight = normalize(vec3(0.65, 0.75, 0.55));
        float spec = pow(max(dot(reflect(-studioLight, N), V), 0.0), 16.0);
        float rimDiffuse = max(dot(N, studioLight), 0.0);

        float morphFade = 1.0 - smoothstep(0.28, 0.64, vMorph);

        if (vCapR < 0.0) {
          // Smoked graphite-slate glass shaft (90-95% neutral chrome)
          vec3 darkGraphite = vec3(0.09, 0.095, 0.12);
          vec3 smokySlate = vec3(0.20, 0.21, 0.25);
          vec3 shaftBase = mix(darkGraphite, smokySlate, vTone);

          // Cool silver studio rim reflection on cylindrical glass edge
          vec3 studioRimColor = vec3(0.84, 0.86, 0.90);
          vec3 body = shaftBase + studioRimColor * (fresnel * 0.42 + spec * 0.36 + rimDiffuse * 0.12);

          // Restrained #003DFF Xenon tip trace focused strictly at final 10%
          float tipHeat = smoothstep(0.90, 1.0, vT);
          vec3 xenonBleed = mix(vec3(0.0, 0.24, 1.0), vec3(0.28, 0.46, 1.0), smoothstep(0.94, 1.0, vT));
          body = mix(body, xenonBleed, tipHeat * (0.72 + 0.28 * (1.0 - fresnel)));

          // Top-left atmospheric dissolve into studio frost ground
          float rootFade = smoothstep(0.0, 0.22, vT);
          gl_FragColor = vec4(body, rootFade * morphFade);
        } else {
          // Circular silver-core to Xenon electric-blue glass end-cap face
          vec3 iceHot = vec3(0.95, 0.96, 0.98);
          vec3 xenonGlow = vec3(0.0, 0.24, 1.0);
          vec3 graphiteBevel = vec3(0.11, 0.12, 0.16);

          float coreMix = smoothstep(0.0, 0.72, vCapR);
          float rimMix = smoothstep(0.68, 1.0, vCapR);
          vec3 faceColor = mix(iceHot, xenonGlow, coreMix * (0.64 + vSeed * 0.26));
          faceColor = mix(faceColor, graphiteBevel, rimMix * 0.82);
          faceColor += vec3(0.12, 0.14, 0.18) * spec;

          gl_FragColor = vec4(faceColor, morphFade);
        }
      }
    `,
  });

  const rodMesh = new THREE.Mesh(rodGeo, rodMaterial);
  rodMesh.frustumCulled = false;
  rodMesh.renderOrder = 1;
  rootGroup.add(rodMesh);

  // ---------------------------------------------------------------------------
  // LAYER 2: 1,500 Painter-Sorted Tufted Iris Crown Strands (State B)
  // ---------------------------------------------------------------------------
  const IRIS_COUNT = 1500;
  const IRIS_SEGS = 16;

  const basePositions = [];
  const baseT = [];
  const baseSide = [];
  const baseIndices = [];

  for (let i = 0; i <= IRIS_SEGS; i++) {
    const t = i / IRIS_SEGS;
    basePositions.push(-1, t, 0, 1, t, 0);
    baseT.push(t, t);
    baseSide.push(-1, 1);
    if (i < IRIS_SEGS) {
      const idx = i * 2;
      baseIndices.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
    }
  }

  const irisGeo = new THREE.InstancedBufferGeometry();
  irisGeo.instanceCount = IRIS_COUNT;
  irisGeo.setIndex(baseIndices);
  irisGeo.setAttribute('position', new THREE.Float32BufferAttribute(basePositions, 3));
  irisGeo.setAttribute('aT', new THREE.Float32BufferAttribute(baseT, 1));
  irisGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(baseSide, 1));

  // Tufted crown density function matching IRIS_AI reference ring:
  // Continuous lush upper arch; separated tufts on flanks; very sparse bottom gap.
  const crownDensity = (theta) => {
    const s = Math.sin(theta);
    if (s > 0.28) {
      return 0.68 + 0.32 * Math.pow((s - 0.28) / 0.72, 0.75);
    }
    if (s >= -0.55) {
      const clump = 0.03 + 0.97 * Math.pow(0.5 + 0.5 * Math.sin(theta * 15.0 + 0.35), 3.4);
      const flankFalloff = 0.25 + 0.75 * ((s + 0.55) / 0.83);
      return clump * flankFalloff;
    }
    return 0.035;
  };

  const strandRecords = [];
  for (let i = 0; i < IRIS_COUNT; i++) {
    let theta = 0;
    do {
      theta = rng() * Math.PI * 2;
    } while (rng() > crownDensity(theta));

    strandRecords.push({
      seed: rng(),
      angle: theta,
      layer: rng(),
      lengthScale: i % 43 === 0 ? 1.55 : 0.72 + rng() * 0.5,
    });
  }

  // Sort back-to-front by layer ascending so dark bronze shadows draw behind bright gold highlights
  strandRecords.sort((a, b) => a.layer - b.layer);

  const irisSeeds = new Float32Array(IRIS_COUNT);
  const irisAngles = new Float32Array(IRIS_COUNT);
  const irisLayers = new Float32Array(IRIS_COUNT);
  const irisLengths = new Float32Array(IRIS_COUNT);

  for (let i = 0; i < IRIS_COUNT; i++) {
    irisSeeds[i] = strandRecords[i].seed;
    irisAngles[i] = strandRecords[i].angle;
    irisLayers[i] = strandRecords[i].layer;
    irisLengths[i] = strandRecords[i].lengthScale;
  }

  irisGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(irisSeeds, 1));
  irisGeo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(irisAngles, 1));
  irisGeo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(irisLayers, 1));
  irisGeo.setAttribute('aLengthScale', new THREE.InstancedBufferAttribute(irisLengths, 1));

  const irisMaterial = new THREE.ShaderMaterial({
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aT;
      attribute float aSide;
      attribute float aSeed;
      attribute float aAngle;
      attribute float aLayer;
      attribute float aLengthScale;

      uniform float uTime;
      uniform float uMorph;

      varying float vT;
      varying float vSide;
      varying float vSeed;
      varying float vLayer;
      varying float vMorphVis;

      vec3 cubicBezier(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
        float u = 1.0 - t;
        return u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;
      }

      void main() {
        vT = aT;
        vSide = aSide;
        vSeed = aSeed;
        vLayer = aLayer;

        float vis = smoothstep(0.16, 0.62, uMorph);
        vMorphVis = vis;

        float stagger = aSeed * 0.18;
        float m = clamp((uMorph - 0.14) / 0.86 - stagger * 0.4, 0.0, 1.0);
        m = m * m * (3.0 - 2.0 * m);

        // Origin bundled near State A tips so fibers blossom radially from the bundle core
        vec3 posA = vec3(
          0.28 + cos(aAngle) * 0.24 * aT,
          -0.12 + sin(aAngle) * 0.22 * aT,
          1.15 * (1.0 - aT) + 0.6
        );

        // State B radial golden iris crown (open pupil, thick upper crown, tufted sides)
        float s = sin(aAngle);
        float topArch = smoothstep(0.15, 0.95, s);
        float sideTuft = mix(0.26, 0.44, aSeed);
        float radialReach = mix(sideTuft, 0.68, topArch) * aLengthScale;
        if (s < -0.55) {
          radialReach = mix(0.14, 0.22, aSeed);
        }

        float innerR = 0.86 + aLayer * 0.08;
        float outerR = innerR + radialReach + 0.045 * sin(aAngle * 7.0 + aSeed * 8.0);
        float theta = aAngle + 0.065 * sin(aT * 2.4 + aSeed * 5.0);

        vec2 dir = vec2(cos(theta), sin(theta));
        vec2 ringCenter = vec2(0.0, -0.18);
        float zArc = sin(aT * 3.14159) * (0.07 + aLayer * 0.08);
        float tipLean = 0.28 * topArch + (aLayer - 0.5) * 0.22;

        vec3 bRoot = vec3(ringCenter + dir * innerR, -0.14 + aLayer * 0.16);
        vec3 bCtrl1 = vec3(ringCenter + dir * mix(innerR, outerR, 0.35), zArc + tipLean * 0.3);
        vec3 bCtrl2 = vec3(ringCenter + dir * mix(innerR, outerR, 0.72), zArc + tipLean * 0.7);
        vec3 bTip = vec3(ringCenter + dir * outerR, tipLean);

        float pulse = 1.0 + sin(uTime * 1.4 - aSeed * 6.0) * 0.015 * aT;
        vec3 posB = cubicBezier(bRoot, bCtrl1, bCtrl2, bTip, aT) * vec3(pulse, pulse, 1.0);
        vec3 posB2 = cubicBezier(bRoot, bCtrl1, bCtrl2, bTip, min(aT + 0.02, 1.0)) * vec3(pulse, pulse, 1.0);

        vec3 centerPos = mix(posA, posB, m);
        vec3 nextPos = mix(posA + vec3(0.0, -0.02, 0.0), posB2, m);

        vec3 tangent = normalize(nextPos - centerPos + vec3(0.0001, 0.0001, 0.0));
        vec3 viewDir = normalize(cameraPosition - centerPos);
        vec3 sideVec = normalize(cross(tangent, viewDir));

        // Fine tapered optical hair width: 0.0085 base -> 0.0018 fine tip
        float width = mix(0.0085, 0.0018, smoothstep(0.15, 1.0, aT));
        if (aLengthScale > 1.35) {
          width *= 0.55;
        }

        vec3 finalPos = centerPos + sideVec * (aSide * width);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
      }
    `,
    fragmentShader: `
      varying float vT;
      varying float vSide;
      varying float vSeed;
      varying float vLayer;
      varying float vMorphVis;

      void main() {
        float radial = clamp(1.0 - abs(vSide), 0.0, 1.0);
        float edgeAlpha = smoothstep(0.0, 0.42, radial);

        // Neutral smoked graphite-silver iris blades with crisp tip glints
        vec3 backRoot = vec3(0.30, 0.32, 0.38);
        vec3 backMid = vec3(0.14, 0.15, 0.20);
        vec3 backTip = vec3(0.22, 0.25, 0.36);
        vec3 backCol = mix(backRoot, backMid, smoothstep(0.14, 0.48, vT));
        backCol = mix(backCol, backTip, smoothstep(0.58, 0.96, vT));

        vec3 frontRoot = vec3(0.56, 0.58, 0.66);
        vec3 frontMid = vec3(0.26, 0.28, 0.36);
        vec3 frontTip = vec3(0.0, 0.24, 1.0);
        vec3 frontCol = mix(frontRoot, frontMid, smoothstep(0.14, 0.54, vT));
        frontCol = mix(frontCol, frontTip, smoothstep(0.76, 0.98, vT));

        float depthMix = smoothstep(0.32, 0.66, vLayer);
        vec3 color = mix(backCol, frontCol, depthMix);
        color += vec3(0.06, 0.07, 0.09) * pow(radial, 3.0) * smoothstep(0.25, 0.85, vT);

        float rootFade = smoothstep(0.06, 0.34, vT);
        float tipFade = 1.0 - smoothstep(0.95, 1.0, vT) * 0.25;
        float alpha = edgeAlpha * rootFade * tipFade * vMorphVis * mix(0.72, 0.95, vLayer);

        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const irisMesh = new THREE.Mesh(irisGeo, irisMaterial);
  irisMesh.frustumCulled = false;
  irisMesh.renderOrder = 2;
  rootGroup.add(irisMesh);

  // ---------------------------------------------------------------------------
  // LAYER 2B: 18 Delicate Silver-White Radial Filaments on Upper-Right Arc (State B)
  // ---------------------------------------------------------------------------
  const RAY_COUNT = 18;
  const rayGeo = new THREE.InstancedBufferGeometry();
  rayGeo.instanceCount = RAY_COUNT;
  rayGeo.setIndex([0, 1, 2, 1, 3, 2]);
  rayGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3)
  );
  rayGeo.setAttribute('aT', new THREE.Float32BufferAttribute([0, 0, 1, 1], 1));
  rayGeo.setAttribute('aSide', new THREE.Float32BufferAttribute([-1, 1, -1, 1], 1));

  const rayAngles = new Float32Array(RAY_COUNT);
  const raySeeds = new Float32Array(RAY_COUNT);
  for (let i = 0; i < RAY_COUNT; i++) {
    const minRad = (-38 * Math.PI) / 180;
    const maxRad = (85 * Math.PI) / 180;
    rayAngles[i] = minRad + (i / (RAY_COUNT - 1)) * (maxRad - minRad) + (rng() - 0.5) * 0.04;
    raySeeds[i] = rng();
  }
  rayGeo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(rayAngles, 1));
  rayGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(raySeeds, 1));

  const rayMaterial = new THREE.ShaderMaterial({
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aT;
      attribute float aSide;
      attribute float aAngle;
      attribute float aSeed;

      uniform float uMorph;
      varying float vT;
      varying float vAlpha;

      void main() {
        vT = aT;
        vAlpha = smoothstep(0.60, 0.94, uMorph);

        vec2 dir = vec2(cos(aAngle), sin(aAngle));
        vec2 perp = vec2(-dir.y, dir.x);
        float r0 = 1.44 + aSeed * 0.08;
        float r1 = 1.88 + aSeed * 0.16;
        float r = mix(r0, r1, aT);
        vec2 center = vec2(0.0, -0.18) + dir * r;
        vec3 pos = vec3(center + perp * (aSide * 0.004), 0.14);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying float vT;
      varying float vAlpha;

      void main() {
        float fade = smoothstep(0.0, 0.25, vT) * (1.0 - smoothstep(0.75, 1.0, vT));
        gl_FragColor = vec4(0.96, 0.96, 0.95, fade * vAlpha * 0.65);
      }
    `,
  });

  const rayMesh = new THREE.Mesh(rayGeo, rayMaterial);
  rayMesh.frustumCulled = false;
  rayMesh.renderOrder = 2;
  rootGroup.add(rayMesh);

  // ---------------------------------------------------------------------------
  // LAYER 3: Subtle Soft Amber Tip Bloom + Micro-Bokeh Dust & Hollow Rings
  // ---------------------------------------------------------------------------
  const tipGlowGeo = new THREE.BufferGeometry();
  const tipPositions = new Float32Array(rodLayout.count * 3);
  const tipSeeds = new Float32Array(rodLayout.count);
  for (let i = 0; i < rodLayout.count; i++) {
    tipPositions.set(
      [rodLayout.rods[i].tipX, rodLayout.rods[i].tipY, rodLayout.rods[i].tipZ + 0.04],
      i * 3
    );
    tipSeeds[i] = rodLayout.rods[i].seed;
  }
  tipGlowGeo.setAttribute('position', new THREE.BufferAttribute(tipPositions, 3));
  tipGlowGeo.setAttribute('aSeed', new THREE.BufferAttribute(tipSeeds, 1));

  const tipGlowMaterial = new THREE.ShaderMaterial({
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute float aSeed;
      uniform float uMorph;
      uniform float uPixelRatio;
      varying float vAlpha;

      void main() {
        float fadeOut = 1.0 - smoothstep(0.18, 0.56, uMorph);
        vAlpha = fadeOut * (0.22 + aSeed * 0.06);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = 38.0 * uPixelRatio * (4.0 / max(-mvPos.z, 1.0));
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float halo = pow(smoothstep(0.5, 0.0, d), 2.6);
        gl_FragColor = vec4(0.0, 0.24, 1.0, halo * vAlpha * 0.72);
      }
    `,
  });

  const tipGlowMesh = new THREE.Points(tipGlowGeo, tipGlowMaterial);
  tipGlowMesh.frustumCulled = false;
  tipGlowMesh.renderOrder = 3;
  rootGroup.add(tipGlowMesh);

  const SPARK_COUNT = 26;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkSeed = new Float32Array(SPARK_COUNT);
  const sparkSize = new Float32Array(SPARK_COUNT);
  const sparkKind = new Float32Array(SPARK_COUNT); // 0 = bright dot, 1 = hollow micro-ring

  for (let i = 0; i < SPARK_COUNT; i++) {
    const isRing = i >= 20 ? 1.0 : 0.0;
    const rx = -0.58 + rng() * 1.75;
    const ry = -0.82 + rng() * 1.85;
    const rz = 0.6 + rng() * 1.25;
    sparkPos.set([rx, ry, rz], i * 3);
    sparkSeed[i] = rng();
    sparkSize[i] = isRing > 0.5 ? 11.0 + rng() * 6.0 : 4.5 + rng() * 6.5;
    sparkKind[i] = isRing;
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(sparkSeed, 1));
  sparkGeo.setAttribute('aSize', new THREE.BufferAttribute(sparkSize, 1));
  sparkGeo.setAttribute('aKind', new THREE.BufferAttribute(sparkKind, 1));

  const sparkMaterial = new THREE.ShaderMaterial({
    uniforms: sharedUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute float aSeed;
      attribute float aSize;
      attribute float aKind;

      uniform float uTime;
      uniform float uMorph;
      uniform float uPixelRatio;

      varying float vAlpha;
      varying float vKind;

      void main() {
        vKind = aKind;
        vec3 p = position + vec3(
          sin(uTime * 0.7 + aSeed * 10.0) * 0.04,
          cos(uTime * 0.6 + aSeed * 8.0) * 0.04,
          0.0
        );
        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = aSize * uPixelRatio * (4.2 / max(-mvPos.z, 1.0));
        float morphDim = mix(1.0, 0.18, smoothstep(0.15, 0.7, uMorph));
        vAlpha = morphDim * (0.55 + 0.35 * sin(uTime * 1.8 + aSeed * 15.0));
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vKind;

      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (vKind > 0.5) {
          // Subtle silver-slate hollow micro-ring
          float ring = smoothstep(0.46, 0.38, d) * smoothstep(0.24, 0.32, d);
          gl_FragColor = vec4(0.52, 0.55, 0.64, ring * vAlpha * 0.54);
        } else {
          // Neutral studio silver bokeh dot
          float dotMask = smoothstep(0.44, 0.12, d);
          vec3 col = mix(vec3(0.68, 0.72, 0.80), vec3(0.95, 0.96, 0.98), smoothstep(0.25, 0.0, d));
          gl_FragColor = vec4(col, dotMask * vAlpha * 0.72);
        }
      }
    `,
  });

  const sparkMesh = new THREE.Points(sparkGeo, sparkMaterial);
  sparkMesh.frustumCulled = false;
  sparkMesh.renderOrder = 4;
  rootGroup.add(sparkMesh);

  // ---------------------------------------------------------------------------
  // 3. Resize Handling, Spring State Machine & GPU Sleep Governor
  // ---------------------------------------------------------------------------
  function resizeRenderer() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const aspect = width / height;
    const isMobileViewport = window.innerWidth <= 768;
    renderer.setSize(width, height, false);
    camera.aspect = aspect;
    camera.position.z = isMobileViewport ? 7.3 : aspect < 0.9 ? 7.2 : 5.4;
    rootGroup.position.set(isMobileViewport ? 0.56 : 0, isMobileViewport ? 0.42 : 0, 0);
    camera.updateProjectionMatrix();
  }

  resizeRenderer();
  window.addEventListener('resize', resizeRenderer);

  let targetMorph = 0;
  let currentMorph = 0;
  let manualOverride = null; // null = driven by scroll; 0 or 1 = explicit toggle
  let targetMouseX = 0;
  let targetMouseY = 0;
  let currentMouseX = 0;
  let currentMouseY = 0;

  let isHeroVisible = true;
  let isManualPaused = REDUCED_MOTION;
  let rafId = 0;
  let scrollRafPending = false;
  let lastStateIndex = 0;
  let animElapsed = 0;
  let lastTickNow = performance.now();

  const canHoverFine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (canHoverFine && !REDUCED_MOTION) {
    heroCard.addEventListener('pointermove', (e) => {
      const rect = heroCard.getBoundingClientRect();
      targetMouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.24;
      targetMouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.2;
    });
    heroCard.addEventListener('pointerleave', () => {
      targetMouseX = 0;
      targetMouseY = 0;
    });
  }

  function updateScrollTarget() {
    if (manualOverride !== null) {
      targetMorph = manualOverride;
      return;
    }
    if (REDUCED_MOTION || isManualPaused) {
      return;
    }
    const stageHeight = heroStage.offsetHeight;
    const viewportHeight = window.innerHeight;
    const scrollableDistance = Math.max(1, stageHeight - viewportHeight);
    const rect = heroStage.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -rect.top / scrollableDistance));
    targetMorph = Math.min(1, progress * 1.15);
  }

  window.addEventListener('scroll', () => {
    if (scrollRafPending) return;
    scrollRafPending = true;
    requestAnimationFrame(() => {
      scrollRafPending = false;
      // Releasing manual toggle once user actively scrolls back past a threshold
      if (manualOverride !== null && window.scrollY > 40) {
        manualOverride = null;
      }
      updateScrollTarget();
    });
  }, { passive: true });

  function renderInstantFrame() {
    sharedUniforms.uTime.value = REDUCED_MOTION ? 0 : animElapsed;
    currentMorph = targetMorph;
    sharedUniforms.uMorph.value = currentMorph;
    rodMaterial.depthWrite = currentMorph < 0.25;
    rodMesh.visible = currentMorph < 0.68;
    irisMesh.visible = currentMorph > 0.12;
    rayMesh.visible = currentMorph > 0.55;
    tipGlowMesh.visible = currentMorph < 0.62;
    renderer.render(scene, camera);
  }

  function tick(now) {
    if (!isHeroVisible || isManualPaused) {
      rafId = 0;
      return;
    }

    const dt = Math.min(0.1, Math.max(0, (now - lastTickNow) * 0.001));
    lastTickNow = now;
    if (!REDUCED_MOTION) {
      animElapsed += dt;
    }
    sharedUniforms.uTime.value = REDUCED_MOTION ? 0 : animElapsed;

    // Damped spring smoothing toward target morph & pointer tilt
    currentMorph += (targetMorph - currentMorph) * (REDUCED_MOTION ? 1 : 0.09);
    sharedUniforms.uMorph.value = currentMorph;

    rodMaterial.depthWrite = currentMorph < 0.25;
    rodMesh.visible = currentMorph < 0.68;
    irisMesh.visible = currentMorph > 0.12;
    rayMesh.visible = currentMorph > 0.55;
    tipGlowMesh.visible = currentMorph < 0.62;

    currentMouseX += (targetMouseX - currentMouseX) * 0.07;
    currentMouseY += (targetMouseY - currentMouseY) * 0.07;
    rootGroup.rotation.y = currentMouseX;
    rootGroup.rotation.x = currentMouseY;

    const discreteIndex = currentMorph >= 0.52 ? 1 : 0;
    if (discreteIndex !== lastStateIndex) {
      lastStateIndex = discreteIndex;
      onMorphChange(discreteIndex);
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (isManualPaused) {
      renderInstantFrame();
      return;
    }
    if (!rafId && isHeroVisible) {
      lastTickNow = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  // GPU Sleep Governor: pause WebGL when hero exits viewport
  if ('IntersectionObserver' in window) {
    const heroObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        isHeroVisible = entry.isIntersecting;
        if (isHeroVisible && !isManualPaused) {
          startLoop();
        } else if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      },
      { threshold: 0.02 }
    );
    heroObserver.observe(heroStage);
  }

  updateScrollTarget();
  startLoop();

  return {
    setManualState(stateIdx) {
      manualOverride = stateIdx === 1 ? 1 : 0;
      targetMorph = manualOverride;
      if (REDUCED_MOTION || isManualPaused) {
        renderInstantFrame();
      }
      onMorphChange(stateIdx);
    },
    setPaused(paused) {
      isManualPaused = Boolean(paused);
      if (isManualPaused) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        renderInstantFrame();
      } else {
        updateScrollTarget();
        startLoop();
      }
    },
    isPaused() {
      return isManualPaused;
    },
  };
}

/**
 * Updates hero typography cleanly using Emil Kowalski's subtle 2px blur crossfade.
 */
function initHeroStateUI() {
  const headline = document.getElementById('hero-headline');
  const lead = document.getElementById('hero-lead');
  const edgeTag = document.getElementById('hero-edge-tag');
  const counter = document.getElementById('hero-counter-tag');
  const btnA = document.getElementById('btn-state-a');
  const btnB = document.getElementById('btn-state-b');
  const btnCycle = document.getElementById('btn-cycle-state');

  let activeIndex = 0;
  let swapTimer = 0;

  function applyState(stateIdx) {
    activeIndex = stateIdx === 1 ? 1 : 0;
    const next = HERO_STATES[activeIndex] || HERO_STATES[0];
    btnA?.classList.toggle('is-active', activeIndex === 0);
    btnB?.classList.toggle('is-active', activeIndex === 1);
    btnA?.setAttribute('aria-pressed', String(activeIndex === 0));
    btnB?.setAttribute('aria-pressed', String(activeIndex === 1));

    if (counter) counter.textContent = next.counter;
    if (edgeTag) {
      edgeTag.textContent = next.edgeTag;
      edgeTag.classList.toggle('is-visible', activeIndex === 1);
    }

    if (!headline || !lead) return;
    if (REDUCED_MOTION) {
      headline.innerHTML = next.headline;
      lead.textContent = next.lead;
      return;
    }

    clearTimeout(swapTimer);
    headline.classList.add('is-morphing');
    lead.classList.add('is-morphing');

    swapTimer = window.setTimeout(() => {
      headline.innerHTML = next.headline;
      lead.textContent = next.lead;
      headline.classList.remove('is-morphing');
      lead.classList.remove('is-morphing');
    }, 130);
  }

  const sceneController = initIrisScene({ onMorphChange: applyState });
  const btnMotion = document.getElementById('btn-toggle-motion');

  if (btnMotion) {
    const syncMotionButton = (paused) => {
      btnMotion.setAttribute('aria-pressed', String(paused));
      btnMotion.textContent = paused ? 'Resume motion' : 'Pause motion';
    };
    syncMotionButton(sceneController ? sceneController.isPaused() : REDUCED_MOTION);
    btnMotion.addEventListener('click', () => {
      if (!sceneController) return;
      const nextPaused = !sceneController.isPaused();
      sceneController.setPaused(nextPaused);
      syncMotionButton(nextPaused);
    });
  }

  btnA?.addEventListener('click', () => {
    if (sceneController) sceneController.setManualState(0);
    else applyState(0);
  });

  btnB?.addEventListener('click', () => {
    if (sceneController) sceneController.setManualState(1);
    else applyState(1);
  });

  btnCycle?.addEventListener('click', () => {
    const nextIdx = activeIndex === 0 ? 1 : 0;
    if (sceneController) sceneController.setManualState(nextIdx);
    else applyState(nextIdx);
  });
}

/**
 * Downstream scrollytelling choreography (staggered card pops + vertical metric slot reels).
 */
function bindTierCardToggles() {
  const tierButtons = document.querySelectorAll('.tier-receipt-btn');

  function toggleCard(targetBtn) {
    const targetCard = targetBtn.closest('.tier-card');
    if (!targetCard) return;
    const wasOpen = targetCard.classList.contains('is-sticker-open');
    tierButtons.forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = 'Inspect fixture receipt';
      btn.closest('.tier-card')?.classList.remove('is-sticker-open');
    });
    if (!wasOpen) {
      targetCard.classList.add('is-sticker-open');
      targetBtn.setAttribute('aria-expanded', 'true');
      targetBtn.textContent = 'Hide fixture receipt';
    }
  }

  tierButtons.forEach((btn) => {
    btn.addEventListener('click', () => toggleCard(btn));
  });
}

function initScrollChoreography() {
  const cards = document.querySelectorAll('.reveal-card');
  const reels = document.querySelectorAll('.reel-strip');

  bindTierCardToggles();

  if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
    cards.forEach((c) => c.classList.add('is-revealed'));
    reels.forEach((r) => r.classList.add('is-rolled'));
    return;
  }

  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');

        entry.target.querySelectorAll('.reel-strip').forEach((reel) => {
          reel.classList.add('is-rolled');
        });
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.18, rootMargin: '0px 0px -40px 0px' }
  );

  cards.forEach((card) => revealObserver.observe(card));
}

const ATTACK_PLAIN_VERDICTS = {
  'under-count-4':
    'Blocked — the contract unlocks only when you submit 5, 9, or 10 distinct stamps, not 4.',
  'duplicate-slot':
    'Blocked — the covenant loop requires strictly ascending stamp slots, rejecting duplicate Stamp #1.',
  'fake-category':
    'Blocked — every badge category ID must match the contract’s verified TokenHunt registry slot.',
  'anti-burn-keep-stamps':
    'Blocked — Output 2 must stay completely empty of tokens, proving spent stamps are burned forever.',
  'steal-baton':
    'Blocked — Output 0 must return the minting baton back to the cindr contract itself.',
};

/**
 * Wires live backend telemetry (/api/health) and adversarial proofs (POST /api/attack).
 */
function initBackendProofs() {
  const networkTag = document.getElementById('network-tag');
  const scriptBytesEl = document.getElementById('metric-script-bytes');
  const scriptDetailEl = document.getElementById('metric-script-detail');
  const attackButtons = document.querySelectorAll('.attack-btn');
  const receiptPanel = document.getElementById('proof-receipt-panel');
  const statusEl = document.getElementById('receipt-status');
  const timingEl = document.getElementById('receipt-timing');
  const retryBtn = document.getElementById('btn-retry-attack');
  const plainEl = document.getElementById('receipt-plain');
  const ruleEl = document.getElementById('receipt-rule');
  const vmOutputEl = document.getElementById('receipt-vm-error');

  let activeAbort = null;
  let lastAttackType = 'under-count-4';

  fetch('/api/health')
    .then((r) => (r.ok ? r.json() : null))
    .then((health) => {
      if (!health) {
        if (networkTag) networkTag.textContent = '[ offline_preview ]';
        return;
      }
      if (networkTag) {
        const mode = health.networkMode ? `${health.networkMode} · ` : '';
        networkTag.textContent = `[ ${health.networkTarget.toLowerCase()} ]`;
        networkTag.setAttribute('title', `Backend: ${mode}${health.status}`);
      }
      if (health.contracts?.forge) {
        const f = health.contracts.forge;
        if (scriptBytesEl && typeof f.redeemScriptBytes === 'number') {
          scriptBytesEl.textContent = String(f.redeemScriptBytes);
        }
        if (scriptDetailEl && typeof f.redeemOpcodesCount === 'number') {
          scriptDetailEl.textContent = `Instantiated P2SH32 covenant (${f.redeemOpcodesCount} opcodes · ${f.bytecodeBytes}B raw template).`;
        }
      }
    })
    .catch(() => {
      if (networkTag) {
        networkTag.textContent = '[ backend_offline ]';
        networkTag.setAttribute('title', 'Could not reach /api/health');
      }
    });

  async function executeAttack(attackType, triggerBtn) {
    lastAttackType = attackType;
    if (activeAbort) {
      activeAbort.abort();
    }
    const controller = new AbortController();
    activeAbort = controller;

    attackButtons.forEach((b) => {
      b.classList.remove('is-selected');
      b.setAttribute('aria-pressed', 'false');
    });
    if (triggerBtn) {
      triggerBtn.classList.add('is-selected');
      triggerBtn.setAttribute('aria-pressed', 'true');
    }

    if (retryBtn) retryBtn.hidden = true;
    if (vmOutputEl) vmOutputEl.classList.add('is-loading');
    if (timingEl) timingEl.textContent = 'Running CashVM…';
    if (plainEl) {
      plainEl.textContent = 'Running this invalid transaction through Bitcoin Cash CashVM…';
    }

    try {
      const res = await fetch('/api/attack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attackType }),
        signal: controller.signal,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }

      if (controller !== activeAbort) return;

      if (statusEl) {
        statusEl.textContent = data.failingLine
          ? `rejected at line ${data.failingLine}`
          : 'rejected on-chain';
      }
      if (timingEl) {
        timingEl.textContent = `verified in ${data.receipt?.executionTimeMs ?? 0}ms`;
      }
      if (plainEl) {
        plainEl.textContent =
          ATTACK_PLAIN_VERDICTS[attackType] || 'Blocked cleanly by CashVM consensus.';
      }
      if (ruleEl) ruleEl.textContent = data.expectedRule;
      if (vmOutputEl) vmOutputEl.textContent = data.vmError;

      if (window.innerWidth <= 900 && receiptPanel) {
        receiptPanel.scrollIntoView({
          behavior: REDUCED_MOTION ? 'auto' : 'smooth',
          block: 'nearest',
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (statusEl) statusEl.textContent = 'verification error';
      if (timingEl) timingEl.textContent = 'request failed';
      if (retryBtn) retryBtn.hidden = false;
      if (plainEl) {
        plainEl.textContent = 'Could not reach the CashVM runner — check the server and retry.';
      }
      if (ruleEl) ruleEl.textContent = '';
      if (vmOutputEl) {
        vmOutputEl.textContent = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (controller === activeAbort && vmOutputEl) {
        vmOutputEl.classList.remove('is-loading');
      }
    }
  }

  attackButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const attackType = btn.getAttribute('data-attack');
      if (attackType) executeAttack(attackType, btn);
    });
  });

  retryBtn?.addEventListener('click', () => {
    const activeBtn = Array.from(attackButtons).find(
      (b) => b.getAttribute('data-attack') === lastAttackType
    );
    executeAttack(lastAttackType, activeBtn ?? null);
  });
}

initHeroStateUI();
initScrollChoreography();
initBackendProofs();
