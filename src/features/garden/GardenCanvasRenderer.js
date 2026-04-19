const SPECIES_COLORS = {
  birch: "#d6b980",
  bamboo: "#5fb87a",
  pine: "#3f7f5f",
  oak: "#8a6a43",
  rare: "#f57f6e"
};

function project(point, width, height) {
  const scale = Math.min(width, height) * 0.17;
  const x = width * 0.5 + point[0] * scale;
  const y = height - 26 - point[1] * scale - point[2] * scale * 0.24;
  return [x, y];
}

export function renderGardenSnapshot(canvas, snapshot) {
  if (!canvas || !snapshot) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#152e3d");
  gradient.addColorStop(1, "#0e2230");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, height - 44, width, 44);

  for (const tree of snapshot.trees) {
    const color = SPECIES_COLORS[tree.species] || "#8a6a43";
    for (const segment of tree.segments) {
      const worldStart = [
        tree.position[0] + segment.start[0],
        tree.position[1] + segment.start[1],
        tree.position[2] + segment.start[2]
      ];
      const worldEnd = [
        tree.position[0] + segment.end[0],
        tree.position[1] + segment.end[1],
        tree.position[2] + segment.end[2]
      ];
      const [sx, sy] = project(worldStart, width, height);
      const [ex, ey] = project(worldEnd, width, height);

      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, segment.radius * 9);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    for (const bud of tree.buds) {
      const worldBud = [tree.position[0] + bud[0], tree.position[1] + bud[1], tree.position[2] + bud[2]];
      const [bx, by] = project(worldBud, width, height);
      ctx.fillStyle = "rgba(255,192,203,0.85)";
      ctx.beginPath();
      ctx.arc(bx, by, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (snapshot.milestones.blossomEvent) {
    for (let i = 0; i < 80; i += 1) {
      const x = (i * 53) % width;
      const y = (i * 97 + 31) % height;
      ctx.fillStyle = "rgba(255,173,193,0.35)";
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
