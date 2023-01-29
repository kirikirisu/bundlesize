import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import brotli from "brotli-size";
import { filesize } from "filesize";

interface BaseGraph {
  file: string;
}

interface ChunkGraph extends BaseGraph {
  imports: string[];
}

interface EntryGraph extends BaseGraph {
  src: string[];
  isEntry?: boolean;
  imports: string[];
}

interface Manifest {
  [key: string]: ChunkGraph | EntryGraph | BaseGraph;
}

interface SizeInfo {
  originalSize: number;
  brotliSize: number;
}

const currentDir = process.cwd();
const chunkSizeList = new Map<string, SizeInfo>();

const getChunkSize = async (
  graph: BaseGraph | ChunkGraph | EntryGraph,
  manifestPath: string,
  chunkname: string,
  manifest: Manifest
): Promise<SizeInfo> => {
  const resolvedOwnChunk = resolve(
    currentDir,
    dirname(manifestPath),
    graph.file
  );
  const { size: originalSize } = await stat(resolvedOwnChunk);
  const brotliSize = await brotli(await readFile(resolvedOwnChunk));
  const ownSizeInfo = { originalSize, brotliSize };

  // BaseGraph (leaf graph)
  if (!("imports" in graph)) {
    chunkSizeList.set(chunkname, ownSizeInfo);
    return ownSizeInfo;
  }

  let depsTotalSize: SizeInfo = { originalSize: 0, brotliSize: 0 };
  for (const innerChunkname of graph.imports) {
    const cache = chunkSizeList.get(innerChunkname);
    if (cache) {
      depsTotalSize = {
        originalSize: cache.originalSize + depsTotalSize.originalSize,
        brotliSize: cache.brotliSize + depsTotalSize.brotliSize,
      };
      continue;
    }

    const icg = manifest[innerChunkname];
    const depsSizeInfo = await getChunkSize(
      icg,
      manifestPath,
      innerChunkname,
      manifest
    );
    depsTotalSize = {
      originalSize: depsTotalSize.originalSize + depsSizeInfo.originalSize,
      brotliSize: depsTotalSize.brotliSize + depsSizeInfo.brotliSize,
    };
  }

  return {
    originalSize: ownSizeInfo.originalSize + depsTotalSize.originalSize,
    brotliSize: ownSizeInfo.brotliSize + depsTotalSize.brotliSize,
  };
};

(async (manifestPath: string) => {
  const manifest: Manifest = JSON.parse(
    await readFile(manifestPath, { encoding: "utf8" })
  );

  const bundleNameList = Object.keys(manifest);
  for (const bundlename of bundleNameList) {
    const bundleGraph = manifest[bundlename];

    if (!("isEntry" in bundleGraph)) continue;

    const innerChunkSize = await getChunkSize(
      bundleGraph,
      manifestPath,
      bundlename,
      manifest
    );

    chunkSizeList.set(bundlename, innerChunkSize);
  }
  console.log("chunkSizeList", chunkSizeList.size);

  bundleNameList.forEach((name) => {
    if (name.startsWith("src/")) {
      console.log(
        `${name}: originalSize: ${filesize(
          chunkSizeList.get(name)?.originalSize
        )} brotliSize: ${filesize(chunkSizeList.get(name)?.brotliSize)}`
      );
    }
  });
})("./data/vite/manifest.json");
