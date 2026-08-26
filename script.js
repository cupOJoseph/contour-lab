const REFERENCE_WIDTH = 878;
const REFERENCE_HEIGHT = 1180;
const ARTWORK_CENTER = [620, 570];
const CONTOUR_EXTENSION = Math.hypot(REFERENCE_WIDTH, REFERENCE_HEIGHT) * 4;
const DOTS_PER_LINE = 2;
const DOT_TRAVEL_MS = 7000;

const DEFAULTS = Object.freeze({
  canvasWidth: REFERENCE_WIDTH,
  canvasHeight: REFERENCE_HEIGHT,
  lineCount: 10,
  centerX: 0,
  centerY: 0,
  spread: 100,
  bend: 100,
  rotation: 0,
  lineWidth: 3,
  opacity: 78,
  showDots: false,
  background: "#315ea8",
  lineColor: "#edf4ff",
  signatureColor: "#ffffff",
  signature: "Open Offering",
  showSignature: true
});

const SOURCE_CONTOURS = [
  [350, -30, 430, 185, 505, 385, 558, 422, 613, 461, 649, 389, 668, 283, 685, 183, 681, 66, 687, -30],
  [138, -30, 264, 190, 411, 427, 515, 493, 587, 538, 641, 493, 670, 394, 708, 266, 704, 100, 719, -30],
  [-30, 330, 162, 483, 359, 616, 477, 624, 587, 632, 646, 559, 683, 444, 725, 311, 733, 111, 752, -30],
  [-30, 783, 235, 797, 466, 795, 587, 666, 682, 565, 711, 386, 739, 230, 764, 94, 777, 17, 786, -30],
  [-30, 1056, 231, 978, 461, 859, 605, 718, 705, 620, 748, 439, 779, 258, 804, 114, 816, 17, 820, -30],
  [82, 1210, 279, 1046, 501, 903, 640, 751, 747, 635, 794, 457, 829, 278, 852, 151, 866, 35, 873, -30],
  [295, 1210, 457, 1027, 607, 874, 714, 716, 806, 580, 849, 411, 882, 251, 897, 173, 910, 69, 918, -30],
  [378, 1210, 526, 1032, 652, 888, 753, 726, 836, 592, 883, 423, 918, 260, 936, 176, 949, 71, 958, -30],
  [412, 1210, 557, 1045, 690, 899, 789, 740, 872, 606, 918, 438, 953, 274, 973, 181, 987, 72, 997, -30],
  [448, 1210, 593, 1053, 724, 910, 824, 753, 909, 619, 953, 452, 989, 287, 1009, 193, 1025, 80, 1035, -30]
];

const form = document.querySelector("#controls");
const canvas = document.querySelector(".contours");
const posterFrame = document.querySelector(".poster-frame");
const canvasSizeLabel = document.querySelector("#canvas-size-label");
const randomizeButton = document.querySelector("#randomize-button");
const resetButton = document.querySelector("#reset-button");
const pauseButton = document.querySelector("#pause-button");
const exportSvgButton = document.querySelector("#export-svg-button");
const exportPngButton = document.querySelector("#export-png-button");
let frameRequest;
let motionTime = 0;
let previousFrameTime;
let motionPaused = false;

function readDimension(value, fallback) {
  const dimension = Math.round(Number(value));
  return Number.isFinite(dimension) && dimension > 0
    ? Math.min(4096, Math.max(256, dimension))
    : fallback;
}

function readSettings() {
  const data = new FormData(form);

  return {
    canvasWidth: readDimension(data.get("canvasWidth"), REFERENCE_WIDTH),
    canvasHeight: readDimension(data.get("canvasHeight"), REFERENCE_HEIGHT),
    lineCount: Number(data.get("lineCount")),
    centerX: Number(data.get("centerX")),
    centerY: Number(data.get("centerY")),
    spread: Number(data.get("spread")),
    bend: Number(data.get("bend")),
    rotation: Number(data.get("rotation")),
    lineWidth: Number(data.get("lineWidth")),
    opacity: Number(data.get("opacity")),
    showDots: data.get("showDots") === "on",
    background: data.get("background"),
    lineColor: data.get("lineColor"),
    signatureColor: data.get("signatureColor"),
    signature: data.get("signature").trim(),
    showSignature: data.get("showSignature") === "on"
  };
}

function interpolateContour(position) {
  const lastIndex = SOURCE_CONTOURS.length - 1;
  const lowerIndex = Math.max(0, Math.min(lastIndex - 1, Math.floor(position)));
  const upperIndex = lowerIndex + 1;
  const amount = position - lowerIndex;

  return SOURCE_CONTOURS[lowerIndex].map((value, index) => {
    const nextValue = SOURCE_CONTOURS[upperIndex][index];
    return value + (nextValue - value) * amount;
  });
}

function transformPoint(x, y, centerPoint, settings) {
  const spread = settings.spread / 100;
  const bend = settings.bend / 100;
  const rotation = (settings.rotation * Math.PI) / 180;
  const spreadX = centerPoint[0] + (x - centerPoint[0]) * spread;
  const spreadY = centerPoint[1] + (y - centerPoint[1]) * spread;
  const bentX = ARTWORK_CENTER[0] + (spreadX - ARTWORK_CENTER[0]) * bend;
  const relativeX = bentX - ARTWORK_CENTER[0];
  const relativeY = spreadY - ARTWORK_CENTER[1];

  return [
    ARTWORK_CENTER[0] + relativeX * Math.cos(rotation) - relativeY * Math.sin(rotation) + (settings.centerX / 100) * REFERENCE_WIDTH,
    ARTWORK_CENTER[1] + relativeX * Math.sin(rotation) + relativeY * Math.cos(rotation) + (settings.centerY / 100) * REFERENCE_HEIGHT
  ];
}

function buildContourGeometry(points, centerPoints, settings) {
  const transformed = [];

  for (let index = 0; index < points.length; index += 2) {
    transformed.push(...transformPoint(points[index], points[index + 1], [centerPoints[index], centerPoints[index + 1]], settings));
  }

  const last = transformed.length - 2;
  const startDirectionX = transformed[0] - transformed[2];
  const startDirectionY = transformed[1] - transformed[3];
  const startLength = Math.hypot(startDirectionX, startDirectionY) || 1;
  const endDirectionX = transformed[last] - transformed[last - 2];
  const endDirectionY = transformed[last + 1] - transformed[last - 1];
  const endLength = Math.hypot(endDirectionX, endDirectionY) || 1;
  const extendedStart = [
    transformed[0] + (startDirectionX / startLength) * CONTOUR_EXTENSION,
    transformed[1] + (startDirectionY / startLength) * CONTOUR_EXTENSION
  ];
  const extendedEnd = [
    transformed[last] + (endDirectionX / endLength) * CONTOUR_EXTENSION,
    transformed[last + 1] + (endDirectionY / endLength) * CONTOUR_EXTENSION
  ];

  return { points: transformed, extendedStart, extendedEnd };
}

function traceContour(context, geometry) {
  const { points, extendedStart, extendedEnd } = geometry;
  context.beginPath();
  context.moveTo(...extendedStart);
  context.lineTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 6) {
    context.bezierCurveTo(
      points[index], points[index + 1],
      points[index + 2], points[index + 3],
      points[index + 4], points[index + 5]
    );
  }
  context.lineTo(...extendedEnd);
  context.stroke();
}

function buildContourGeometries(settings) {
  const centerContour = interpolateContour((SOURCE_CONTOURS.length - 1) / 2);
  const geometries = [];

  for (let index = 0; index < settings.lineCount; index += 1) {
    const position = (index / (settings.lineCount - 1)) * (SOURCE_CONTOURS.length - 1);
    geometries.push(buildContourGeometry(interpolateContour(position), centerContour, settings));
  }

  return geometries;
}

function sampleContour(points) {
  const samples = [[points[0], points[1]]];

  for (let index = 2; index < points.length; index += 6) {
    const start = samples[samples.length - 1];
    const controlA = [points[index], points[index + 1]];
    const controlB = [points[index + 2], points[index + 3]];
    const end = [points[index + 4], points[index + 5]];

    for (let step = 1; step <= 28; step += 1) {
      const amount = step / 28;
      const inverse = 1 - amount;
      samples.push([
        inverse ** 3 * start[0] + 3 * inverse ** 2 * amount * controlA[0] + 3 * inverse * amount ** 2 * controlB[0] + amount ** 3 * end[0],
        inverse ** 3 * start[1] + 3 * inverse ** 2 * amount * controlA[1] + 3 * inverse * amount ** 2 * controlB[1] + amount ** 3 * end[1]
      ]);
    }
  }

  return samples;
}

function pointAlongContour(samples, progress) {
  const lengths = [];
  let totalLength = 0;

  for (let index = 1; index < samples.length; index += 1) {
    totalLength += Math.hypot(samples[index][0] - samples[index - 1][0], samples[index][1] - samples[index - 1][1]);
    lengths.push(totalLength);
  }

  const target = progress * totalLength;
  const segmentIndex = Math.max(0, lengths.findIndex((length) => length >= target));
  const previousLength = segmentIndex === 0 ? 0 : lengths[segmentIndex - 1];
  const segmentLength = lengths[segmentIndex] - previousLength || 1;
  const amount = (target - previousLength) / segmentLength;
  const start = samples[segmentIndex];
  const end = samples[segmentIndex + 1];

  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount
  ];
}

function getDotPositions(contours, settings, timestamp) {
  const dots = [];

  contours.forEach((points, lineIndex) => {
    const samples = sampleContour(points);

    for (let dotIndex = 0; dotIndex < DOTS_PER_LINE; dotIndex += 1) {
      const phase = (timestamp / DOT_TRAVEL_MS + dotIndex / DOTS_PER_LINE + lineIndex * 0.037) % 1;
      const progress = 1 - phase;
      const [x, y] = pointAlongContour(samples, progress);
      dots.push({ x, y, radius: Math.max(2.5, settings.lineWidth * 1.45) });
    }
  });

  return dots;
}

function drawMovingDots(context, contours, settings, timestamp) {
  context.save();
  context.globalAlpha = Math.min(1, settings.opacity / 100 + 0.18);
  context.fillStyle = settings.lineColor;
  getDotPositions(contours, settings, timestamp).forEach(({ x, y, radius }) => {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function getSignatureLayout(width, height) {
  const scale = Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
  return {
    x: width - 20 * scale,
    y: height - (REFERENCE_HEIGHT - 1074) * scale,
    fontSize: 21 * scale,
    maxWidth: 330 * scale
  };
}

function drawSignature(context, width, height, settings) {
  if (!settings.showSignature || !settings.signature) return;
  const layout = getSignatureLayout(width, height);

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = settings.signatureColor;
  context.font = `700 ${layout.fontSize}px Arial, Helvetica, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "alphabetic";
  context.fillText(settings.signature, layout.x, layout.y, layout.maxWidth);
  context.restore();
}

function renderScene(context, width, height, settings, timestamp = 0) {
  const scale = Math.max(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT);
  const artworkWidth = REFERENCE_WIDTH * scale;
  const artworkHeight = REFERENCE_HEIGHT * scale;
  const offsetX = (width - artworkWidth) / 2;
  const offsetY = (height - artworkHeight) / 2;
  const geometries = buildContourGeometries(settings);

  context.save();
  context.fillStyle = settings.background;
  context.fillRect(0, 0, width, height);
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  context.strokeStyle = settings.lineColor;
  context.lineWidth = settings.lineWidth;
  context.globalAlpha = settings.opacity / 100;
  context.lineCap = "round";
  context.lineJoin = "round";
  geometries.forEach((geometry) => traceContour(context, geometry));

  if (settings.showDots) drawMovingDots(context, geometries.map(({ points }) => points), settings, timestamp);

  context.restore();
  drawSignature(context, width, height, settings);
}

function drawPreview(timestamp = 0) {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const context = canvas.getContext("2d");

  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  const settings = readSettings();

  if (settings.showDots && !motionPaused) {
    if (previousFrameTime !== undefined) {
      motionTime += Math.min(timestamp - previousFrameTime, 100);
    }
    previousFrameTime = timestamp;
  } else {
    previousFrameTime = undefined;
  }

  renderScene(context, bounds.width, bounds.height, settings, motionTime);
  if (settings.showDots && !motionPaused) frameRequest = requestAnimationFrame(drawPreview);
}

function scheduleDraw() {
  cancelAnimationFrame(frameRequest);
  frameRequest = requestAnimationFrame(drawPreview);
}

function updateLabels() {
  const settings = readSettings();
  const values = {
    "line-count": settings.lineCount,
    "center-x": `${settings.centerX}%`,
    "center-y": `${settings.centerY}%`,
    spread: `${settings.spread}%`,
    bend: `${settings.bend}%`,
    rotation: `${settings.rotation}°`,
    "line-width": `${settings.lineWidth}px`,
    opacity: `${settings.opacity}%`
  };

  Object.entries(values).forEach(([id, value]) => {
    document.querySelector(`output[for="${id}"]`).value = value;
  });

  ["background", "lineColor", "signatureColor"].forEach((name) => {
    document.querySelector(`[data-color-value="${name}"]`).textContent = settings[name].toUpperCase();
  });

  posterFrame.style.setProperty("--canvas-ratio", settings.canvasWidth / settings.canvasHeight);
  canvasSizeLabel.textContent = `${settings.canvasWidth} × ${settings.canvasHeight}`;
}

function update() {
  const settings = readSettings();
  if (!settings.showDots) {
    motionPaused = false;
    motionTime = 0;
    previousFrameTime = undefined;
  }
  pauseButton.disabled = !settings.showDots;
  pauseButton.textContent = motionPaused ? "Resume dots" : "Pause dots";
  pauseButton.setAttribute("aria-pressed", String(motionPaused));
  updateLabels();
  scheduleDraw();
}

function toggleMotion() {
  if (!readSettings().showDots) return;
  motionPaused = !motionPaused;
  previousFrameTime = undefined;
  pauseButton.textContent = motionPaused ? "Resume dots" : "Pause dots";
  pauseButton.setAttribute("aria-pressed", String(motionPaused));
  scheduleDraw();
}

function resetControls() {
  Object.entries(DEFAULTS).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
  });
  update();
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomizeContours() {
  const ranges = {
    lineCount: [5, 20],
    centerX: [-30, 30],
    centerY: [-30, 30],
    spread: [55, 155],
    bend: [65, 145],
    rotation: [-25, 25]
  };

  Object.entries(ranges).forEach(([name, [min, max]]) => {
    form.elements.namedItem(name).value = randomInteger(min, max);
  });

  update();
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportPng() {
  const settings = readSettings();
  const exportCanvas = document.createElement("canvas");
  const context = exportCanvas.getContext("2d");
  exportCanvas.width = settings.canvasWidth;
  exportCanvas.height = settings.canvasHeight;
  renderScene(context, settings.canvasWidth, settings.canvasHeight, settings, motionTime);

  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `contour-poster-${settings.canvasWidth}x${settings.canvasHeight}.png`);
  }, "image/png");
}

function formatSvgNumber(value) {
  return Number(value.toFixed(2));
}

function contourToSvgPath({ points, extendedStart, extendedEnd }) {
  let path = `M ${formatSvgNumber(extendedStart[0])} ${formatSvgNumber(extendedStart[1])}`;
  path += ` L ${formatSvgNumber(points[0])} ${formatSvgNumber(points[1])}`;

  for (let index = 2; index < points.length; index += 6) {
    path += ` C ${formatSvgNumber(points[index])} ${formatSvgNumber(points[index + 1])}`;
    path += ` ${formatSvgNumber(points[index + 2])} ${formatSvgNumber(points[index + 3])}`;
    path += ` ${formatSvgNumber(points[index + 4])} ${formatSvgNumber(points[index + 5])}`;
  }

  path += ` L ${formatSvgNumber(extendedEnd[0])} ${formatSvgNumber(extendedEnd[1])}`;
  return path;
}

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  })[character]);
}

function createSvg(settings) {
  const geometries = buildContourGeometries(settings);
  const scale = Math.max(settings.canvasWidth / REFERENCE_WIDTH, settings.canvasHeight / REFERENCE_HEIGHT);
  const offsetX = (settings.canvasWidth - REFERENCE_WIDTH * scale) / 2;
  const offsetY = (settings.canvasHeight - REFERENCE_HEIGHT * scale) / 2;
  const paths = geometries.map((geometry) => `    <path d="${contourToSvgPath(geometry)}" />`).join("\n");
  const dotOpacity = Math.min(1, settings.opacity / 100 + 0.18);
  const dots = settings.showDots
    ? getDotPositions(geometries.map(({ points }) => points), settings, motionTime)
        .map(({ x, y, radius }) => `    <circle cx="${formatSvgNumber(x)}" cy="${formatSvgNumber(y)}" r="${formatSvgNumber(radius)}" />`)
        .join("\n")
    : "";
  let signature = "";

  if (settings.showSignature && settings.signature) {
    const layout = getSignatureLayout(settings.canvasWidth, settings.canvasHeight);
    const measureContext = document.createElement("canvas").getContext("2d");
    measureContext.font = `700 ${layout.fontSize}px Arial, Helvetica, sans-serif`;
    const width = measureContext.measureText(settings.signature).width;
    const lengthAttribute = width > layout.maxWidth ? ` textLength="${formatSvgNumber(layout.maxWidth)}" lengthAdjust="spacingAndGlyphs"` : "";
    signature = `  <text x="${formatSvgNumber(layout.x)}" y="${formatSvgNumber(layout.y)}" fill="${settings.signatureColor}" font-family="Arial, Helvetica, sans-serif" font-size="${formatSvgNumber(layout.fontSize)}" font-weight="700" text-anchor="end"${lengthAttribute}>${escapeXml(settings.signature)}</text>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${settings.canvasWidth}" height="${settings.canvasHeight}" viewBox="0 0 ${settings.canvasWidth} ${settings.canvasHeight}">
  <rect width="${settings.canvasWidth}" height="${settings.canvasHeight}" fill="${settings.background}" />
  <g transform="translate(${formatSvgNumber(offsetX)} ${formatSvgNumber(offsetY)}) scale(${formatSvgNumber(scale)})">
  <g fill="none" stroke="${settings.lineColor}" stroke-width="${settings.lineWidth}" stroke-opacity="${settings.opacity / 100}" stroke-linecap="round" stroke-linejoin="round">
${paths}
  </g>
${dots ? `  <g fill="${settings.lineColor}" fill-opacity="${dotOpacity}">\n${dots}\n  </g>` : ""}
  </g>
${signature}
</svg>`;
}

function exportSvg() {
  const settings = readSettings();
  const svg = createSvg(settings);
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `contour-poster-${settings.canvasWidth}x${settings.canvasHeight}.svg`);
}

form.addEventListener("input", update);
randomizeButton.addEventListener("click", randomizeContours);
resetButton.addEventListener("click", resetControls);
pauseButton.addEventListener("click", toggleMotion);
exportSvgButton.addEventListener("click", exportSvg);
exportPngButton.addEventListener("click", exportPng);

const resizeObserver = new ResizeObserver(scheduleDraw);
resizeObserver.observe(canvas);
update();
