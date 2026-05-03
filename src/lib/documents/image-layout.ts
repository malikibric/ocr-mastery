export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLayoutWord {
  text: string;
  confidence: number;
  bbox: OcrBoundingBox;
}

export interface ImageOcrLayout {
  width: number;
  height: number;
  words: OcrLayoutWord[];
}

export interface ImageOcrTextBlock {
  text: string;
  bbox: OcrBoundingBox;
}

interface ClusteredWord extends OcrLayoutWord {
  centerX: number;
  centerY: number;
}

interface WordCluster {
  words: ClusteredWord[];
  bbox: OcrBoundingBox;
}

interface ClusterSplitCandidate {
  score: number;
  first: WordCluster;
  second: WordCluster;
}

interface WhitespaceSplitOptions {
  minimumScore: number;
  minimumChildWords: number;
  minimumChildRatio: number;
}

const MIN_WORDS_FOR_MULTI_DOCUMENT = 24;
const MIN_CLUSTER_WORDS = 8;
const MAX_CLUSTERS = 4;

function getBBoxForWords(words: ClusteredWord[]): OcrBoundingBox {
  return {
    x0: Math.min(...words.map((word) => word.bbox.x0)),
    y0: Math.min(...words.map((word) => word.bbox.y0)),
    x1: Math.max(...words.map((word) => word.bbox.x1)),
    y1: Math.max(...words.map((word) => word.bbox.y1))
  };
}

function getCenter(box: OcrBoundingBox) {
  return {
    x: (box.x0 + box.x1) / 2,
    y: (box.y0 + box.y1) / 2
  };
}

function getOverlapRatio(
  startA: number,
  endA: number,
  startB: number,
  endB: number
) {
  const overlap = Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  const smallestSpan = Math.min(endA - startA, endB - startB);

  if (smallestSpan <= 0) {
    return 0;
  }

  return overlap / smallestSpan;
}

function getGap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
) {
  if (endA < startB) {
    return startB - endA;
  }

  if (endB < startA) {
    return startA - endB;
  }

  return 0;
}

function shouldMergeClusters(
  left: WordCluster,
  right: WordCluster,
  imageWidth: number,
  imageHeight: number
) {
  const xOverlap = getOverlapRatio(
    left.bbox.x0,
    left.bbox.x1,
    right.bbox.x0,
    right.bbox.x1
  );
  const yOverlap = getOverlapRatio(
    left.bbox.y0,
    left.bbox.y1,
    right.bbox.y0,
    right.bbox.y1
  );
  const leftCenter = getCenter(left.bbox);
  const rightCenter = getCenter(right.bbox);
  const xCenterDistance = Math.abs(leftCenter.x - rightCenter.x);
  const yCenterDistance = Math.abs(leftCenter.y - rightCenter.y);
  const verticalGap = getGap(
    left.bbox.y0,
    left.bbox.y1,
    right.bbox.y0,
    right.bbox.y1
  );
  const horizontalGap = getGap(
    left.bbox.x0,
    left.bbox.x1,
    right.bbox.x0,
    right.bbox.x1
  );

  const verticallyStackedFragment =
    xOverlap >= 0.8 &&
    xCenterDistance <= imageWidth * 0.12 &&
    (verticalGap <= imageHeight * 0.14 || yOverlap >= 0.2);

  const horizontallySplitFragment =
    yOverlap >= 0.8 &&
    yCenterDistance <= imageHeight * 0.12 &&
    (horizontalGap <= imageWidth * 0.14 || xOverlap >= 0.2);

  return verticallyStackedFragment || horizontallySplitFragment;
}

function mergeNearbyClusters(
  clusters: WordCluster[],
  imageWidth: number,
  imageHeight: number
) {
  const remaining = [...clusters];
  let didMerge = true;

  while (didMerge) {
    didMerge = false;

    outer: for (let index = 0; index < remaining.length; index++) {
      for (let otherIndex = index + 1; otherIndex < remaining.length; otherIndex++) {
        if (
          shouldMergeClusters(
            remaining[index],
            remaining[otherIndex],
            imageWidth,
            imageHeight
          )
        ) {
          const mergedWords = [
            ...remaining[index].words,
            ...remaining[otherIndex].words
          ];
          remaining.splice(otherIndex, 1);
          remaining.splice(index, 1, {
            words: mergedWords,
            bbox: getBBoxForWords(mergedWords)
          });
          didMerge = true;
          break outer;
        }
      }
    }
  }

  return remaining;
}

function boxesOverlap(left: OcrBoundingBox, right: OcrBoundingBox) {
  return !(
    left.x1 < right.x0 ||
    right.x1 < left.x0 ||
    left.y1 < right.y0 ||
    right.y1 < left.y0
  );
}

function buildConnectivityClusters(
  words: ClusteredWord[],
  imageWidth: number,
  imageHeight: number
) {
  const averageWordHeight =
    words.reduce((total, word) => total + (word.bbox.y1 - word.bbox.y0), 0) /
    words.length;
  const horizontalPadding = Math.max(averageWordHeight * 1.5, imageWidth * 0.01);
  const verticalPadding = Math.max(averageWordHeight * 2.5, imageHeight * 0.015);
  const parents = new Array(words.length).fill(0).map((_, index) => index);
  const sizes = new Array(words.length).fill(1);

  function find(index: number): number {
    if (parents[index] === index) {
      return index;
    }

    parents[index] = find(parents[index]);
    return parents[index];
  }

  function unite(left: number, right: number) {
    let leftRoot = find(left);
    let rightRoot = find(right);

    if (leftRoot === rightRoot) {
      return;
    }

    if (sizes[leftRoot] < sizes[rightRoot]) {
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    }

    parents[rightRoot] = leftRoot;
    sizes[leftRoot] += sizes[rightRoot];
  }

  for (let index = 0; index < words.length; index++) {
    const leftWord = words[index];
    const expandedLeft = {
      x0: leftWord.bbox.x0 - horizontalPadding,
      y0: leftWord.bbox.y0 - verticalPadding,
      x1: leftWord.bbox.x1 + horizontalPadding,
      y1: leftWord.bbox.y1 + verticalPadding
    };

    for (let otherIndex = index + 1; otherIndex < words.length; otherIndex++) {
      const rightWord = words[otherIndex];
      const expandedRight = {
        x0: rightWord.bbox.x0 - horizontalPadding,
        y0: rightWord.bbox.y0 - verticalPadding,
        x1: rightWord.bbox.x1 + horizontalPadding,
        y1: rightWord.bbox.y1 + verticalPadding
      };

      if (boxesOverlap(expandedLeft, expandedRight)) {
        unite(index, otherIndex);
      }
    }
  }

  const groups = new Map<number, ClusteredWord[]>();

  for (let index = 0; index < words.length; index++) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(words[index]);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter((group) => group.length >= MIN_CLUSTER_WORDS)
    .map((group) => ({
      words: group,
      bbox: getBBoxForWords(group)
    }));
}

function getDistance(left: ClusteredWord, right: ClusteredWord) {
  const xDistance = left.centerX - right.centerX;
  const yDistance = left.centerY - right.centerY;
  return Math.sqrt(xDistance * xDistance + yDistance * yDistance);
}

function getClusterCentroid(words: ClusteredWord[]) {
  return {
    x: words.reduce((total, word) => total + word.centerX, 0) / words.length,
    y: words.reduce((total, word) => total + word.centerY, 0) / words.length
  };
}

function initializeCentroids(points: ClusteredWord[], clusterCount: number) {
  const centroids = [points[0]];

  while (centroids.length < clusterCount) {
    let farthestPoint = points[0];
    let farthestDistance = -1;

    for (const point of points) {
      const nearestDistance = Math.min(
        ...centroids.map((centroid) => getDistance(point, centroid))
      );

      if (nearestDistance > farthestDistance) {
        farthestPoint = point;
        farthestDistance = nearestDistance;
      }
    }

    centroids.push(farthestPoint);
  }

  return centroids.map((centroid) => ({
    x: centroid.centerX,
    y: centroid.centerY
  }));
}

function runKMeans(points: ClusteredWord[], clusterCount: number) {
  const centroids = initializeCentroids(points, clusterCount);
  const assignments = new Array(points.length).fill(0);

  for (let iteration = 0; iteration < 20; iteration++) {
    let changed = false;

    for (let index = 0; index < points.length; index++) {
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex++) {
        const xDistance = points[index].centerX - centroids[centroidIndex].x;
        const yDistance = points[index].centerY - centroids[centroidIndex].y;
        const distance = xDistance * xDistance + yDistance * yDistance;

        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = centroidIndex;
        }
      }

      if (assignments[index] !== bestCluster) {
        assignments[index] = bestCluster;
        changed = true;
      }
    }

    const sums = Array.from({ length: clusterCount }, () => ({
      x: 0,
      y: 0,
      count: 0
    }));

    for (let index = 0; index < points.length; index++) {
      const cluster = assignments[index];
      sums[cluster].x += points[index].centerX;
      sums[cluster].y += points[index].centerY;
      sums[cluster].count += 1;
    }

    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex++) {
      if (sums[centroidIndex].count > 0) {
        centroids[centroidIndex] = {
          x: sums[centroidIndex].x / sums[centroidIndex].count,
          y: sums[centroidIndex].y / sums[centroidIndex].count
        };
      }
    }

    if (!changed) {
      break;
    }
  }

  return assignments;
}

function runSeededKMeans(
  points: ClusteredWord[],
  centroids: Array<{ x: number; y: number }>,
  imageWidth: number,
  imageHeight: number
) {
  const nextCentroids = centroids.map((centroid) => ({ ...centroid }));
  const assignments = new Array(points.length).fill(0);

  for (let iteration = 0; iteration < 20; iteration++) {
    let changed = false;

    for (let index = 0; index < points.length; index++) {
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let centroidIndex = 0; centroidIndex < nextCentroids.length; centroidIndex++) {
        const xDistance =
          (points[index].centerX - nextCentroids[centroidIndex].x) / imageWidth;
        const yDistance =
          (points[index].centerY - nextCentroids[centroidIndex].y) / imageHeight;
        const distance = xDistance * xDistance + yDistance * yDistance * 1.35;

        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = centroidIndex;
        }
      }

      if (assignments[index] !== bestCluster) {
        assignments[index] = bestCluster;
        changed = true;
      }
    }

    const sums = Array.from({ length: nextCentroids.length }, () => ({
      x: 0,
      y: 0,
      count: 0
    }));

    for (let index = 0; index < points.length; index++) {
      const cluster = assignments[index];
      sums[cluster].x += points[index].centerX;
      sums[cluster].y += points[index].centerY;
      sums[cluster].count += 1;
    }

    for (let centroidIndex = 0; centroidIndex < nextCentroids.length; centroidIndex++) {
      if (sums[centroidIndex].count > 0) {
        nextCentroids[centroidIndex] = {
          x: sums[centroidIndex].x / sums[centroidIndex].count,
          y: sums[centroidIndex].y / sums[centroidIndex].count
        };
      }
    }

    if (!changed) {
      break;
    }
  }

  return assignments;
}

function calculateSilhouette(points: ClusteredWord[], assignments: number[], k: number) {
  if (points.length < 2) {
    return -1;
  }

  let total = 0;

  for (let index = 0; index < points.length; index++) {
    const ownCluster = assignments[index];
    let intraClusterDistance = 0;
    let intraClusterCount = 0;
    let nearestOtherClusterDistance = Number.POSITIVE_INFINITY;

    for (let otherIndex = 0; otherIndex < points.length; otherIndex++) {
      if (index === otherIndex) {
        continue;
      }

      const distance = getDistance(points[index], points[otherIndex]);

      if (assignments[otherIndex] === ownCluster) {
        intraClusterDistance += distance;
        intraClusterCount += 1;
      }
    }

    const averageIntraClusterDistance = intraClusterCount
      ? intraClusterDistance / intraClusterCount
      : 0;

    for (let cluster = 0; cluster < k; cluster++) {
      if (cluster === ownCluster) {
        continue;
      }

      let clusterDistance = 0;
      let clusterCount = 0;

      for (let otherIndex = 0; otherIndex < points.length; otherIndex++) {
        if (assignments[otherIndex] !== cluster) {
          continue;
        }

        clusterDistance += getDistance(points[index], points[otherIndex]);
        clusterCount += 1;
      }

      if (clusterCount > 0) {
        nearestOtherClusterDistance = Math.min(
          nearestOtherClusterDistance,
          clusterDistance / clusterCount
        );
      }
    }

    const denominator = Math.max(
      averageIntraClusterDistance,
      nearestOtherClusterDistance || 1
    );
    const score =
      denominator === 0 || !Number.isFinite(nearestOtherClusterDistance)
        ? 0
        : (nearestOtherClusterDistance - averageIntraClusterDistance) / denominator;

    total += score;
  }

  return total / points.length;
}

function buildClusters(words: ClusteredWord[], assignments: number[], clusterCount: number) {
  const groups = Array.from({ length: clusterCount }, () => [] as ClusteredWord[]);

  for (let index = 0; index < words.length; index++) {
    groups[assignments[index]].push(words[index]);
  }

  return groups
    .filter((group) => group.length > 0)
    .map((group) => ({
      words: group,
      bbox: getBBoxForWords(group)
    }));
}

function getMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function findWhitespaceSplit(
  cluster: WordCluster,
  axis: "horizontal" | "vertical",
  imageWidth: number,
  imageHeight: number
): ClusterSplitCandidate | null {
  const span =
    axis === "horizontal"
      ? cluster.bbox.y1 - cluster.bbox.y0
      : cluster.bbox.x1 - cluster.bbox.x0;
  const averageWordHeight =
    cluster.words.reduce(
      (total, word) => total + (word.bbox.y1 - word.bbox.y0),
      0
    ) / cluster.words.length;

  if (
    (axis === "horizontal" && span < imageHeight * 0.18) ||
    (axis === "vertical" && span < imageWidth * 0.18)
  ) {
    return null;
  }

  const sortedWords = [...cluster.words].sort((left, right) =>
    axis === "horizontal"
      ? left.bbox.y0 - right.bbox.y0
      : left.bbox.x0 - right.bbox.x0
  );
  const allGaps: number[] = [];
  let bestCandidate: ClusterSplitCandidate | null = null;

  for (let index = 0; index < sortedWords.length - 1; index++) {
    const currentEnd =
      axis === "horizontal" ? sortedWords[index].bbox.y1 : sortedWords[index].bbox.x1;
    const nextStart =
      axis === "horizontal"
        ? sortedWords[index + 1].bbox.y0
        : sortedWords[index + 1].bbox.x0;
    const gap = nextStart - currentEnd;

    if (gap <= 0) {
      continue;
    }

    allGaps.push(gap);
  }

  const medianGap = getMedian(allGaps);

  for (let index = 0; index < sortedWords.length - 1; index++) {
    const currentEnd =
      axis === "horizontal" ? sortedWords[index].bbox.y1 : sortedWords[index].bbox.x1;
    const nextStart =
      axis === "horizontal"
        ? sortedWords[index + 1].bbox.y0
        : sortedWords[index + 1].bbox.x0;
    const gap = nextStart - currentEnd;

    if (
      gap <= 0 ||
      gap < averageWordHeight * 2.5 ||
      gap < Math.max(medianGap * 1.8, 1)
    ) {
      continue;
    }

    const splitAt = (currentEnd + nextStart) / 2;
    const firstWords = cluster.words.filter((word) =>
      axis === "horizontal" ? word.centerY < splitAt : word.centerX < splitAt
    );
    const secondWords = cluster.words.filter((word) =>
      axis === "horizontal" ? word.centerY >= splitAt : word.centerX >= splitAt
    );

    if (
      firstWords.length < MIN_CLUSTER_WORDS ||
      secondWords.length < MIN_CLUSTER_WORDS
    ) {
      continue;
    }

    const balance =
      Math.min(firstWords.length, secondWords.length) /
      Math.max(firstWords.length, secondWords.length);
    const score = (gap / averageWordHeight) * balance;

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        score,
        first: {
          words: firstWords,
          bbox: getBBoxForWords(firstWords)
        },
        second: {
          words: secondWords,
          bbox: getBBoxForWords(secondWords)
        }
      };
    }
  }

  return bestCandidate;
}

function splitClustersByWhitespace(
  initialClusters: WordCluster[],
  imageWidth: number,
  imageHeight: number,
  options: WhitespaceSplitOptions
) {
  const clusters = [...initialClusters];

  while (clusters.length < MAX_CLUSTERS) {
    let bestIndex = -1;
    let bestSplit: ClusterSplitCandidate | null = null;

    for (let index = 0; index < clusters.length; index++) {
      const splitCandidates = [
        findWhitespaceSplit(clusters[index], "horizontal", imageWidth, imageHeight),
        findWhitespaceSplit(clusters[index], "vertical", imageWidth, imageHeight)
      ];
      const minimumWordsForCluster = Math.max(
        options.minimumChildWords,
        Math.ceil(clusters[index].words.length * options.minimumChildRatio)
      );

      for (const split of splitCandidates) {
        const smallerSideWords = split
          ? Math.min(split.first.words.length, split.second.words.length)
          : 0;

        if (
          split &&
          split.score >= options.minimumScore &&
          smallerSideWords >= minimumWordsForCluster &&
          (!bestSplit || split.score > bestSplit.score)
        ) {
          bestSplit = split;
          bestIndex = index;
        }
      }
    }

    if (!bestSplit) {
      break;
    }

    clusters.splice(bestIndex, 1, bestSplit.first, bestSplit.second);
  }

  return mergeNearbyClusters(clusters, imageWidth, imageHeight)
    .filter((cluster) => cluster.words.length >= MIN_CLUSTER_WORDS)
    .sort((left, right) => right.words.length - left.words.length);
}

function findTwoTopOneBottomClusters(
  words: ClusteredWord[],
  imageWidth: number,
  imageHeight: number
) {
  if (getMinimumClusterCount(words, imageWidth, imageHeight) !== 3) {
    return null;
  }

  const leftSeedWords = words.filter(
    (word) => word.centerX <= imageWidth * 0.46 && word.centerY <= imageHeight * 0.6
  );
  const rightSeedWords = words.filter(
    (word) => word.centerX >= imageWidth * 0.54 && word.centerY <= imageHeight * 0.72
  );
  const bottomSeedWords = words.filter(
    (word) =>
      word.centerY >= imageHeight * 0.58 &&
      word.centerX >= imageWidth * 0.28 &&
      word.centerX <= imageWidth * 0.75
  );

  if (
    leftSeedWords.length >= MIN_CLUSTER_WORDS &&
    rightSeedWords.length >= MIN_CLUSTER_WORDS &&
    bottomSeedWords.length >= MIN_CLUSTER_WORDS
  ) {
    const seededAssignments = runSeededKMeans(
      words,
      [
        getClusterCentroid(leftSeedWords),
        getClusterCentroid(rightSeedWords),
        getClusterCentroid(bottomSeedWords)
      ],
      imageWidth,
      imageHeight
    );
    const seededClusters = buildClusters(words, seededAssignments, 3);

    if (
      seededClusters.length === 3 &&
      seededClusters.every((cluster) => cluster.words.length >= MIN_CLUSTER_WORDS)
    ) {
      const orderedClusters = orderTwoTopOneBottomClusters(seededClusters);

      if (
        getTwoTopOneBottomGeometryScore(
          orderedClusters,
          imageWidth,
          imageHeight
        ) >= 4 &&
        hasMeaningfulSpatialSeparation(seededClusters, imageWidth, imageHeight)
      ) {
        return orderedClusters;
      }
    }
  }

  const averageWordHeight =
    words.reduce((total, word) => total + (word.bbox.y1 - word.bbox.y0), 0) /
    words.length;
  const centralBandWords = words
    .filter(
      (word) =>
        word.centerX >= imageWidth * 0.28 && word.centerX <= imageWidth * 0.82
    )
    .sort((left, right) => left.bbox.y0 - right.bbox.y0);

  let bestHorizontalCut: number | null = null;
  let bestHorizontalScore = 0;

  for (let index = 0; index < centralBandWords.length - 1; index++) {
    const current = centralBandWords[index];
    const next = centralBandWords[index + 1];
    const gap = next.bbox.y0 - current.bbox.y1;

    if (gap <= 0) {
      continue;
    }

    const cut = (current.bbox.y1 + next.bbox.y0) / 2;

    if (cut < imageHeight * 0.18 || cut > imageHeight * 0.45) {
      continue;
    }

    const topWords = words.filter((word) => word.centerY < cut);
    const bottomWords = words.filter((word) => word.centerY >= cut);

    if (
      topWords.length < MIN_CLUSTER_WORDS * 3 ||
      bottomWords.length < MIN_CLUSTER_WORDS * 2
    ) {
      continue;
    }

    const bottomBBox = getBBoxForWords(bottomWords);
    const balance =
      Math.min(topWords.length, bottomWords.length) /
      Math.max(topWords.length, bottomWords.length);
    const score =
      (gap / averageWordHeight) *
      balance *
      ((bottomBBox.x1 - bottomBBox.x0) / imageWidth);

    if (score > bestHorizontalScore) {
      bestHorizontalScore = score;
      bestHorizontalCut = cut;
    }
  }

  if (!bestHorizontalCut || bestHorizontalScore < 0.4) {
    return null;
  }

  const topWords = words.filter((word) => word.centerY < bestHorizontalCut);
  const bottomWords = words.filter((word) => word.centerY >= bestHorizontalCut);
  const sortedTopWords = [...topWords].sort(
    (left, right) => left.bbox.x0 - right.bbox.x0
  );
  let bestVerticalCut: number | null = null;
  let bestVerticalScore = 0;

  for (let index = 0; index < sortedTopWords.length - 1; index++) {
    const current = sortedTopWords[index];
    const next = sortedTopWords[index + 1];
    const gap = next.bbox.x0 - current.bbox.x1;

    if (gap <= 0 || gap < imageWidth * 0.05) {
      continue;
    }

    const cut = (current.bbox.x1 + next.bbox.x0) / 2;

    if (cut < imageWidth * 0.25 || cut > imageWidth * 0.75) {
      continue;
    }

    const leftWords = topWords.filter((word) => word.centerX < cut);
    const rightWords = topWords.filter((word) => word.centerX >= cut);

    if (
      leftWords.length < MIN_CLUSTER_WORDS * 2 ||
      rightWords.length < MIN_CLUSTER_WORDS * 2
    ) {
      continue;
    }

    const balance =
      Math.min(leftWords.length, rightWords.length) /
      Math.max(leftWords.length, rightWords.length);
    const score = (gap / averageWordHeight) * balance;

    if (score > bestVerticalScore) {
      bestVerticalScore = score;
      bestVerticalCut = cut;
    }
  }

  if (!bestVerticalCut || bestVerticalScore < 0.7) {
    return null;
  }

  const leftWords = topWords.filter((word) => word.centerX < bestVerticalCut);
  const rightWords = topWords.filter((word) => word.centerX >= bestVerticalCut);

  if (
    leftWords.length < MIN_CLUSTER_WORDS ||
    rightWords.length < MIN_CLUSTER_WORDS ||
    bottomWords.length < MIN_CLUSTER_WORDS
  ) {
    return null;
  }

  const clusters = [
    {
      words: leftWords,
      bbox: getBBoxForWords(leftWords)
    },
    {
      words: rightWords,
      bbox: getBBoxForWords(rightWords)
    },
    {
      words: bottomWords,
      bbox: getBBoxForWords(bottomWords)
    }
  ];

  return hasMeaningfulSpatialSeparation(clusters, imageWidth, imageHeight)
    ? clusters
    : null;
}

function buildWhitespaceFallbackClusters(
  words: ClusteredWord[],
  imageWidth: number,
  imageHeight: number
) {
  const initialClusters = buildConnectivityClusters(words, imageWidth, imageHeight);

  return splitClustersByWhitespace(
    initialClusters.length ? initialClusters : [{ words, bbox: getBBoxForWords(words) }],
    imageWidth,
    imageHeight,
    {
      minimumScore: 0.9,
      minimumChildWords: MIN_CLUSTER_WORDS,
      minimumChildRatio: 0
    }
  );
}

function refineClustersWithWhitespaceSplits(
  clusters: WordCluster[],
  imageWidth: number,
  imageHeight: number
) {
  return splitClustersByWhitespace(clusters, imageWidth, imageHeight, {
    minimumScore: 0.5,
    minimumChildWords: MIN_CLUSTER_WORDS * 2,
    minimumChildRatio: 0.15
  });
}

function hasMeaningfulSpatialSeparation(
  clusters: WordCluster[],
  imageWidth: number,
  imageHeight: number
) {
  for (let index = 0; index < clusters.length; index++) {
    for (let otherIndex = index + 1; otherIndex < clusters.length; otherIndex++) {
      const first = getCenter(clusters[index].bbox);
      const second = getCenter(clusters[otherIndex].bbox);
      const xDistance = Math.abs(first.x - second.x);
      const yDistance = Math.abs(first.y - second.y);

      if (xDistance >= imageWidth * 0.15 || yDistance >= imageHeight * 0.18) {
        return true;
      }
    }
  }

  return false;
}

function orderTwoTopOneBottomClusters(clusters: WordCluster[]) {
  const sortedByY = [...clusters].sort(
    (left, right) => getCenter(left.bbox).y - getCenter(right.bbox).y
  );

  return [
    ...sortedByY.slice(0, 2).sort(
      (left, right) => getCenter(left.bbox).x - getCenter(right.bbox).x
    ),
    sortedByY[2]
  ];
}

function getTwoTopOneBottomGeometryScore(
  clusters: WordCluster[],
  imageWidth: number,
  imageHeight: number
) {
  if (clusters.length !== 3) {
    return -1;
  }

  const [leftTopCluster, rightTopCluster, bottomCluster] =
    orderTwoTopOneBottomClusters(clusters);
  const leftTopCenter = getCenter(leftTopCluster.bbox);
  const rightTopCenter = getCenter(rightTopCluster.bbox);
  const bottomCenter = getCenter(bottomCluster.bbox);

  return (
    (Math.abs(leftTopCenter.y - rightTopCenter.y) <= imageHeight * 0.2 ? 1 : 0) +
    (Math.abs(leftTopCenter.x - rightTopCenter.x) >= imageWidth * 0.2 ? 1 : 0) +
    (bottomCenter.y >=
    Math.max(leftTopCenter.y, rightTopCenter.y) + imageHeight * 0.16
      ? 1
      : 0) +
    (bottomCenter.x >= leftTopCenter.x - imageWidth * 0.12 &&
    bottomCenter.x <= rightTopCenter.x + imageWidth * 0.12
      ? 1
      : 0) +
    (bottomCluster.bbox.y1 - bottomCluster.bbox.y0 >= imageHeight * 0.16 ? 1 : 0)
  );
}

function getMinimumClusterCount(
  words: ClusteredWord[],
  imageWidth: number,
  imageHeight: number
) {
  const leftTopWords = words.filter(
    (word) =>
      word.centerX <= imageWidth * 0.42 && word.centerY <= imageHeight * 0.66
  ).length;
  const rightTopWords = words.filter(
    (word) =>
      word.centerX >= imageWidth * 0.58 && word.centerY <= imageHeight * 0.66
  ).length;
  const bottomWords = words.filter(
    (word) =>
      word.centerY >= imageHeight * 0.58 &&
      word.centerX >= imageWidth * 0.18 &&
      word.centerX <= imageWidth * 0.82
  ).length;

  if (
    leftTopWords >= MIN_CLUSTER_WORDS &&
    rightTopWords >= MIN_CLUSTER_WORDS &&
    bottomWords >= MIN_CLUSTER_WORDS
  ) {
    return 3;
  }

  return 2;
}

function wordsToText(words: ClusteredWord[]) {
  if (words.length === 0) {
    return "";
  }

  const averageWordHeight =
    words.reduce((total, word) => total + (word.bbox.y1 - word.bbox.y0), 0) /
    words.length;
  const lineTolerance = Math.max(12, averageWordHeight * 0.75);
  const sortedWords = [...words].sort((left, right) => {
    if (Math.abs(left.centerY - right.centerY) <= lineTolerance) {
      return left.bbox.x0 - right.bbox.x0;
    }

    return left.centerY - right.centerY;
  });

  const lines: ClusteredWord[][] = [];

  for (const word of sortedWords) {
    const lastLine = lines.at(-1);

    if (
      lastLine &&
      Math.abs(
        word.centerY -
          lastLine.reduce((total, item) => total + item.centerY, 0) /
            lastLine.length
      ) <= lineTolerance
    ) {
      lastLine.push(word);
    } else {
      lines.push([word]);
    }
  }

  return lines
    .map((line) =>
      line
        .sort((left, right) => left.bbox.x0 - right.bbox.x0)
        .map((word) => word.text.trim())
        .join(" ")
    )
    .join("\n")
    .trim();
}

function clustersToTextBlocks(clusters: WordCluster[], imageHeight: number) {
  return clustersToImageBlocks(clusters, imageHeight).map((block) => block.text);
}

function clustersToImageBlocks(
  clusters: WordCluster[],
  imageHeight: number
): ImageOcrTextBlock[] {
  return clusters
    .sort((left, right) => {
      const leftCenter = getCenter(left.bbox);
      const rightCenter = getCenter(right.bbox);

      if (Math.abs(leftCenter.y - rightCenter.y) <= imageHeight * 0.12) {
        return leftCenter.x - rightCenter.x;
      }

      return leftCenter.y - rightCenter.y;
    })
    .map((cluster) => ({
      text: wordsToText(cluster.words),
      bbox: cluster.bbox
    }))
    .filter((block) => block.text.length > 0);
}

function normalizeLayoutWords(layout: ImageOcrLayout) {
  return layout.words
    .map((word) => ({
      ...word,
      text: word.text.trim(),
      centerX: (word.bbox.x0 + word.bbox.x1) / 2,
      centerY: (word.bbox.y0 + word.bbox.y1) / 2
    }))
    .filter((word) => word.text.length >= 2 && word.confidence >= 20);
}

export function detectStructuredImageLayoutDocumentCount(layout: ImageOcrLayout) {
  const words = normalizeLayoutWords(layout);

  if (words.length < MIN_WORDS_FOR_MULTI_DOCUMENT) {
    return 0;
  }

  return (
    findTwoTopOneBottomClusters(words, layout.width, layout.height)?.length ?? 0
  );
}

export function splitImageOcrLayoutIntoBlocks(layout: ImageOcrLayout) {
  const words = normalizeLayoutWords(layout);

  if (words.length < MIN_WORDS_FOR_MULTI_DOCUMENT) {
    return [];
  }

  const layoutSpecificClusters = findTwoTopOneBottomClusters(
    words,
    layout.width,
    layout.height
  );
  let bestClusters: WordCluster[] = [];
  let bestScore = -1;
  const minimumClusters = getMinimumClusterCount(
    words,
    layout.width,
    layout.height
  );
  const maximumClusters = Math.min(
    MAX_CLUSTERS,
    Math.floor(words.length / MIN_CLUSTER_WORDS)
  );

  for (
    let clusterCount = minimumClusters;
    clusterCount <= maximumClusters;
    clusterCount++
  ) {
    const assignments = runKMeans(words, clusterCount);
    const silhouette = calculateSilhouette(words, assignments, clusterCount);
    const initialClusters = buildClusters(words, assignments, clusterCount);
    const mergedClusters = mergeNearbyClusters(
      initialClusters,
      layout.width,
      layout.height
    );

    if (
      mergedClusters.length <= 1 ||
      mergedClusters.some((cluster) => cluster.words.length < MIN_CLUSTER_WORDS) ||
      !hasMeaningfulSpatialSeparation(mergedClusters, layout.width, layout.height)
    ) {
      continue;
    }

    const score = silhouette + mergedClusters.length * 0.015;

    if (
      score > bestScore ||
      (Math.abs(score - bestScore) <= 0.02 &&
        bestClusters.length > 0 &&
        mergedClusters.length > bestClusters.length)
    ) {
      bestScore = score;
      bestClusters = mergedClusters;
    }
  }

  if (bestScore < 0.05 || bestClusters.length <= 1) {
    const fallbackClusters = buildWhitespaceFallbackClusters(
      words,
      layout.width,
      layout.height
    );

    if (
      fallbackClusters.length <= 1 ||
      !hasMeaningfulSpatialSeparation(fallbackClusters, layout.width, layout.height)
    ) {
      return [];
    }

    return clustersToImageBlocks(
      layoutSpecificClusters &&
        layoutSpecificClusters.length > fallbackClusters.length
        ? layoutSpecificClusters
        : fallbackClusters,
      layout.height
    );
  }

  const refinedClusters = refineClustersWithWhitespaceSplits(
    bestClusters,
    layout.width,
    layout.height
  );

  const refinedOrBestClusters =
    refinedClusters.length > bestClusters.length ? refinedClusters : bestClusters;
  const finalClusters =
    layoutSpecificClusters &&
    (layoutSpecificClusters.length > refinedOrBestClusters.length ||
      getTwoTopOneBottomGeometryScore(
        layoutSpecificClusters,
        layout.width,
        layout.height
      ) >
        getTwoTopOneBottomGeometryScore(
          refinedOrBestClusters,
          layout.width,
          layout.height
        ))
      ? layoutSpecificClusters
      : refinedOrBestClusters;

  return clustersToImageBlocks(finalClusters, layout.height);
}

export function splitImageOcrLayoutIntoTextBlocks(layout: ImageOcrLayout) {
  return splitImageOcrLayoutIntoBlocks(layout).map((block) => block.text);
}
