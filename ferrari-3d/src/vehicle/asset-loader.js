import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MaterialsVariantsPlugin } from './materials-variants.js';

const BASE = import.meta.env.BASE_URL;

/** Verbose asset diagnostics: on in dev builds, or with ?debug=assets in production. */
export const assetDebug = import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === 'assets';

/** A load failure with a reason the UI can act on. */
export class AssetLoadError extends Error {
  /**
   * @param {string} url
   * @param {'not-found'|'http'|'network'|'parse'} kind
   */
  constructor(url, kind, { status, cause } = {}) {
    const why = { 'not-found': 'file not found', http: `HTTP ${status}`, network: 'network error', parse: 'file could not be parsed' }[kind];
    super(`Could not load ${url}: ${why}`);
    this.name = 'AssetLoadError';
    this.url = url;
    this.kind = kind;
    this.status = status;
    this.cause = cause;
  }
}

function classify(url, err) {
  const status = err?.response?.status;
  if (status === 404) return new AssetLoadError(url, 'not-found', { status, cause: err });
  if (status) return new AssetLoadError(url, 'http', { status, cause: err });
  if (err instanceof TypeError || /network|fetch/i.test(err?.message ?? '')) return new AssetLoadError(url, 'network', { cause: err });
  return new AssetLoadError(url, 'parse', { cause: err });
}

/**
 * One loader for every 3D asset on the page:
 *  - a single GLTFLoader + DRACOLoader (one decoder worker pool, not one per scene)
 *  - each URL is fetched and parsed once; later callers share the same promise
 *  - a scene that needs its own copy of a model (the same car in two scenes)
 *    re-parses the bytes already fetched: one download, independent graphs
 *  - progress is reported per URL to every listener, including late subscribers
 *  - failures reject with an AssetLoadError and are evicted, so a retry refetches
 */
export class AssetLoader {
  constructor({ dracoPath = `${BASE}draco/` } = {}) {
    this.draco = new DRACOLoader();
    this.draco.setDecoderPath(dracoPath);
    this.gltf = new GLTFLoader();
    this.gltf.setDRACOLoader(this.draco);
    this.gltf.register((parser) => new MaterialsVariantsPlugin(parser));
    this.textures = new THREE.TextureLoader();
    this.entries = new Map(); // url → { promise, progress, listeners }
  }

  resolve(path) {
    return /^(https?:)?\/\//.test(path) || path.startsWith(BASE) ? path : `${BASE}${path}`;
  }

  /** Load (or join an in-flight load of) a glTF/GLB. Resolves to the parsed gltf. */
  loadModel(path, { onProgress } = {}) {
    const url = this.resolve(path);
    let entry = this.entries.get(url);
    if (!entry) {
      entry = { progress: 0, listeners: new Set() };
      entry.promise = new Promise((resolve, reject) => {
        const file = new THREE.FileLoader(this.gltf.manager);
        file.setResponseType('arraybuffer');
        file.setRequestHeader(this.gltf.requestHeader);
        file.setWithCredentials(this.gltf.withCredentials);
        file.load(
          url,
          (buffer) => {
            entry.buffer = buffer;
            this.parse(buffer, url).then(resolve, (err) => reject(classify(url, err)));
          },
          (e) => {
            if (!e.lengthComputable && !e.total) return;
            entry.progress = e.loaded / e.total;
            entry.listeners.forEach((fn) => fn(entry.progress));
          },
          (err) => reject(classify(url, err))
        );
      }).then(
        (gltf) => {
          entry.progress = 1;
          entry.listeners.forEach((fn) => fn(1));
          return gltf;
        },
        (err) => {
          this.entries.delete(url);
          throw err;
        }
      );
      this.entries.set(url, entry);
    }
    if (onProgress) {
      entry.listeners.add(onProgress);
      onProgress(entry.progress);
    }
    return entry.promise;
  }

  parse(buffer, url) {
    return this.gltf.parseAsync(buffer, THREE.LoaderUtils.extractUrlBase(url));
  }

  /**
   * An independent copy of a model (its own scene graph and materials), parsed
   * from the bytes of the shared download: for showing the same car in a second
   * scene without a second fetch.
   */
  loadModelCopy(path, { onProgress } = {}) {
    const url = this.resolve(path);
    return this.loadModel(path, { onProgress }).then(() =>
      this.parse(this.entries.get(url).buffer, url).catch((err) => {
        throw classify(url, err);
      })
    );
  }

  loadTexture(path) {
    const url = this.resolve(path);
    let entry = this.entries.get(url);
    if (!entry) {
      entry = {
        progress: 0,
        listeners: new Set(),
        promise: this.textures.loadAsync(url).catch((err) => {
          this.entries.delete(url);
          throw classify(url, err);
        }),
      };
      this.entries.set(url, entry);
    }
    return entry.promise;
  }

  /** Start fetching early (e.g. on idle) without caring about the result yet. */
  prefetch(path) {
    this.loadModel(path).catch(() => {}); // errors surface again on the real request
  }

  isLoaded(path) {
    return this.entries.get(this.resolve(path))?.progress === 1;
  }

  dispose() {
    this.draco.dispose();
    this.entries.clear();
  }
}

/** The page-wide instance. */
export const assets = new AssetLoader();
