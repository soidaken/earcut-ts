/**
 * 此为基于开源项目 https://github.com/mapbox/earcut.git 翻译的typescript版本
 * author:soida
 * mail:flashfin@foxmail.com
 * The open source license is consistent with the original earcut.js project
 */

export interface EarcutNode {
  i: number;
  x: number;
  y: number;
  prev: EarcutNode;
  next: EarcutNode;
  z: number;
  prevZ: EarcutNode | null;
  nextZ: EarcutNode | null;
  steiner: boolean;
}

/**
 *
 * @param data [x1,y1,z1,...]或者[x1,y1,x2,y2,...]
 * @param holeIndices 中间有洞,此为洞的点起始索引,比如第几个点开始是洞,如果没有洞,此参数可以不传
 * @param dim 数据的维度,比如[x,y,z]为3维数据,此时dim=3,如果是[x,y]为2维数据,此时dim=2
 * @returns 返回可以直接用于渲染的索引
 * 对于输入数据,需要预先处理自相交和连续共线点,否则可能输出索引渲染结果不符合预期
 * 建议外环数据逆时针,内环数据顺时针,虽然earcut有一定自动处理顺序能力,但某些情况下依然会出现渲染不符预期
 */
export default function earcut(data: number[], holeIndices?: number[], dim: number = 2): number[] {
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices![0] * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles: number[] = [];

  if (!outerNode || outerNode.next === outerNode.prev) return triangles;

  let minX: number, minY: number, invSize: number;

  if (hasHoles) outerNode = eliminateHoles(data, holeIndices!, outerNode, dim);

  if (data.length > 80 * dim) {
    minX = Infinity;
    minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i];
      const y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }

  earcutLinked(outerNode, triangles, dim, minX!, minY!, invSize!, 0);

  return triangles;
}

function linkedList(data: number[], start: number, end: number, dim: number, clockwise: boolean): EarcutNode | null {
  let last: EarcutNode | undefined;

  if (clockwise === signedArea(data, start, end, dim) > 0) {
    for (let i = start; i < end; i += dim) last = insertNode((i / dim) | 0, data[i], data[i + 1], last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode((i / dim) | 0, data[i], data[i + 1], last);
  }

  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }

  return last || null;
}

function filterPoints(start: EarcutNode | null, end?: EarcutNode | null): EarcutNode | null {
  if (!start) return start;
  if (!end) end = start;

  let p = start,
    again: boolean;
  do {
    again = false;

    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== end);

  return end;
}

function earcutLinked(
  ear: EarcutNode | null,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
  pass: number
): void {
  if (!ear) return;

  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

  let stop = ear;

  while (ear.prev !== ear.next) {
    const prev = ear.prev;
    const next = ear.next;

    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i, ear.i, next.i);

      removeNode(ear);

      ear = next.next;
      stop = next.next;

      continue;
    }

    ear = next;

    if (ear === stop) {
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear), triangles);
        earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(ear, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}

function isEar(ear: EarcutNode): boolean {
  const a = ear.prev,
    b = ear,
    c = ear.next;

  if (area(a, b, c) >= 0) return false;

  const ax = a.x,
    bx = b.x,
    cx = c.x,
    ay = a.y,
    by = b.y,
    cy = c.y;

  const x0 = Math.min(ax, bx, cx),
    y0 = Math.min(ay, by, cy),
    x1 = Math.max(ax, bx, cx),
    y1 = Math.max(ay, by, cy);

  let p = c.next;
  while (p !== a) {
    if (
      p.x >= x0 &&
      p.x <= x1 &&
      p.y >= y0 &&
      p.y <= y1 &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    )
      return false;
    p = p.next;
  }

  return true;
}

function isEarHashed(ear: EarcutNode, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev,
    b = ear,
    c = ear.next;

  if (area(a, b, c) >= 0) return false;

  const ax = a.x,
    bx = b.x,
    cx = c.x,
    ay = a.y,
    by = b.y,
    cy = c.y;

  const x0 = Math.min(ax, bx, cx),
    y0 = Math.min(ay, by, cy),
    x1 = Math.max(ax, bx, cx),
    y1 = Math.max(ay, by, cy);

  const minZ = zOrder(x0, y0, minX, minY, invSize),
    maxZ = zOrder(x1, y1, minX, minY, invSize);

  let p = ear.prevZ,
    n = ear.nextZ;

  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (
      p.x >= x0 &&
      p.x <= x1 &&
      p.y >= y0 &&
      p.y <= y1 &&
      p !== a &&
      p !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    )
      return false;
    p = p.prevZ;

    if (
      n.x >= x0 &&
      n.x <= x1 &&
      n.y >= y0 &&
      n.y <= y1 &&
      n !== a &&
      n !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) &&
      area(n.prev, n, n.next) >= 0
    )
      return false;
    n = n.nextZ;
  }

  while (p && p.z >= minZ) {
    if (
      p.x >= x0 &&
      p.x <= x1 &&
      p.y >= y0 &&
      p.y <= y1 &&
      p !== a &&
      p !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    )
      return false;
    p = p.prevZ;
  }

  while (n && n.z <= maxZ) {
    if (
      n.x >= x0 &&
      n.x <= x1 &&
      n.y >= y0 &&
      n.y <= y1 &&
      n !== a &&
      n !== c &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, n.x, n.y) &&
      area(n.prev, n, n.next) >= 0
    )
      return false;
    n = n.nextZ;
  }

  return true;
}

function cureLocalIntersections(start: EarcutNode, triangles: number[]): EarcutNode {
  let p = start;
  do {
    const a = p.prev,
      b = p.next.next;

    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i, p.i, b.i);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);

  return filterPoints(p)!;
}

function splitEarcut(
  start: EarcutNode,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number
): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next)!;
        c = filterPoints(c, c.next)!;
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function eliminateHoles(data: number[], holeIndices: number[], outerNode: EarcutNode, dim: number): EarcutNode {
  const queue: EarcutNode[] = [];

  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i] * dim;
    const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    const list = linkedList(data, start, end, dim, false)!;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }

  queue.sort(compareXYSlope);

  for (let i = 0; i < queue.length; i++) {
    outerNode = eliminateHole(queue[i], outerNode);
  }

  return outerNode;
}

function compareXYSlope(a: EarcutNode, b: EarcutNode): number {
  let result = a.x - b.x;
  if (result === 0) {
    result = a.y - b.y;
    if (result === 0) {
      const aSlope = (a.next.y - a.y) / (a.next.x - a.x);
      const bSlope = (b.next.y - b.y) / (b.next.x - b.x);
      result = aSlope - bSlope;
    }
  }
  return result;
}

function eliminateHole(hole: EarcutNode, outerNode: EarcutNode): EarcutNode {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next)!;
}

function findHoleBridge(hole: EarcutNode, outerNode: EarcutNode): EarcutNode | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: EarcutNode | undefined;

  if (equals(hole, p)) return p;
  do {
    if (equals(hole, p.next)) return p.next;
    else if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);

  if (!m) return null;

  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;

  p = m;

  do {
    if (
      hx >= p.x &&
      p.x >= mx &&
      hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);

      if (
        locallyInside(p, hole) &&
        (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))
      ) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);

  return m;
}

function sectorContainsSector(m: EarcutNode, p: EarcutNode): boolean {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function indexCurve(start: EarcutNode, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);

  p.prevZ!.nextZ = null;
  p.prevZ = null;

  sortLinked(p);
}

function sortLinked(list: EarcutNode): EarcutNode {
  let numMerges: number;
  let inSize = 1;

  do {
    let p: EarcutNode | null = list;
    let e: EarcutNode | null;
    list = null as any;
    let tail: EarcutNode | null = null;
    numMerges = 0;

    while (p) {
      numMerges++;
      let q = p;
      let pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ!;
        if (!q) break;
      }
      let qSize = inSize;

      while (pSize > 0 || (qSize > 0 && q)) {
        if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
          e = p;
          p = p.nextZ!;
          pSize--;
        } else {
          e = q;
          q = q.nextZ!;
          qSize--;
        }

        if (tail) tail.nextZ = e;
        else list = e;

        e.prevZ = tail;
        tail = e;
      }
      p = q;
    }

    tail!.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);

  return list;
}

function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  x = ((x - minX) * invSize) | 0;
  y = ((y - minY) * invSize) | 0;

  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;

  y = (y | (y << 8)) & 0x00ff00ff;
  y = (y | (y << 4)) & 0x0f0f0f0f;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;

  return x | (y << 1);
}

function getLeftmost(start: EarcutNode): EarcutNode {
  let p = start,
    leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);

  return leftmost;
}

function pointInTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number
): boolean {
  return (
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py)
  );
}

function pointInTriangleExceptFirst(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number
): boolean {
  return !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py);
}

function isValidDiagonal(a: EarcutNode, b: EarcutNode): boolean {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) &&
      locallyInside(b, a) &&
      middleInside(a, b) &&
      (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0)) ||
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0))
  );
}

function area(p: EarcutNode, q: EarcutNode, r: EarcutNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(p1: EarcutNode, p2: EarcutNode): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

function intersects(p1: EarcutNode, q1: EarcutNode, p2: EarcutNode, q2: EarcutNode): boolean {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

function onSegment(p: EarcutNode, q: EarcutNode, r: EarcutNode): boolean {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

function sign(num: number): number {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}

function intersectsPolygon(a: EarcutNode, b: EarcutNode): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);

  return false;
}

function locallyInside(a: EarcutNode, b: EarcutNode): boolean {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a: EarcutNode, b: EarcutNode): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (p.y > py !== p.next.y > py && p.next.y !== p.y && px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x)
      inside = !inside;
    p = p.next;
  } while (p !== a);

  return inside;
}

function splitPolygon(a: EarcutNode, b: EarcutNode): EarcutNode {
  const a2 = createNode(a.i, a.x, a.y);
  const b2 = createNode(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;

  a.next = b;
  b.prev = a;

  a2.next = an;
  an.prev = a2;

  b2.next = a2;
  a2.prev = b2;

  bp.next = b2;
  b2.prev = bp;

  return b2;
}

function insertNode(i: number, x: number, y: number, last?: EarcutNode): EarcutNode {
  const p = createNode(i, x, y);

  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function removeNode(p: EarcutNode): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;

  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function createNode(i: number, x: number, y: number): EarcutNode {
  // @ts-ignore
  return {
    i,
    x,
    y,
    prev: null!,
    next: null!,
    z: 0,
    prevZ: null,
    nextZ: null,
    steiner: false,
  };
}

export function deviation(data: number[], holeIndices: number[] | undefined, dim: number, triangles: number[]): number {
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices![0] * dim : data.length;

  let polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
  if (hasHoles) {
    for (let i = 0, len = holeIndices!.length; i < len; i++) {
      const start = holeIndices![i] * dim;
      const end = i < len - 1 ? holeIndices![i + 1] * dim : data.length;
      polygonArea -= Math.abs(signedArea(data, start, end, dim));
    }
  }

  let trianglesArea = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * dim;
    const b = triangles[i + 1] * dim;
    const c = triangles[i + 2] * dim;
    trianglesArea += Math.abs(
      (data[a] - data[c]) * (data[b + 1] - data[a + 1]) - (data[a] - data[b]) * (data[c + 1] - data[a + 1])
    );
  }

  return polygonArea === 0 && trianglesArea === 0 ? 0 : Math.abs((trianglesArea - polygonArea) / polygonArea);
}

function signedArea(data: number[], start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

export function flatten(data: number[][][]): { vertices: number[]; holes: number[]; dimensions: number } {
  const vertices: number[] = [];
  const holes: number[] = [];
  const dimensions = data[0][0].length;
  let holeIndex = 0;
  let prevLen = 0;

  for (const ring of data) {
    for (const p of ring) {
      for (let d = 0; d < dimensions; d++) vertices.push(p[d]);
    }
    if (prevLen) {
      holeIndex += prevLen;
      holes.push(holeIndex);
    }
    prevLen = ring.length;
  }
  return { vertices, holes, dimensions };
}
