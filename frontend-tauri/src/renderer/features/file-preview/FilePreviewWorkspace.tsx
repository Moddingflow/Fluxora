import {
  ChevronLeft,
  ChevronRight
} from '../../design-system/icons/lucide-compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type {
  FluxoraNifPreviewAssetHandle,
  FluxoraNifPreviewVariant
} from '../../../shared/fluxora-api';
import type { TranslationKey } from '../../../localization';
import {
  createDecodedDdsPreviewTexture,
  createDdsPreviewTexture,
  detectDdsGpuSupport,
  isDdsBuffer,
  readDdsHeader
} from './dds-texture';
import {
  computeNifPreviewCameraFrame,
  createNifPreviewGeometry,
  selectNifPreviewTexturePath
} from './nif-preview-rendering';
import {
  deduplicateNifPreviewPaths,
  mapNifPreviewWithConcurrency,
  nextNifPreviewGeneration
} from './nif-preview-pipeline';
import { NifPreviewResourceCache } from './nif-preview-resource-cache';
import { NifPreviewWorkerClient } from './nif-preview-worker-client';
import type { WorkerNifModel } from './nif-preview-worker-protocol';
import { previewKindById } from './preview-kind-registry';
import { useLocalization } from '../../../localization/react';

interface FilePreviewWorkspaceProps {
  projectDirectory: string;
  initialModPath: string;
  initialRelativePath: string;
  initialFileName: string;
  initialProfileName: string;
  initialKind: string;
}

const nifPreviewWarningKeys = new Set<TranslationKey>([
  'preview.warning.skinnedStatic',
  'preview.warning.noSupportedBlocks',
  'preview.warning.fixtureParseFailed',
  'preview.warning.noGeometry',
  'preview.warning.noDiffuseTexture'
]);

const localizedNifPreviewWarning = (
  warning: string,
  t: (key: TranslationKey) => string
): string => nifPreviewWarningKeys.has(warning as TranslationKey)
  ? t(warning as TranslationKey)
  : t('preview.warning.generic');

type PreviewRenderState = 'idle' | 'loading' | 'ready' | 'error';

const createPreviewOperationId = (): string =>
  `op_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_nif_preview_${Math.random()
    .toString(16)
    .slice(2, 10)}`;

const pathKey = (value: string): string => value.replace(/\\/g, '/').toLowerCase();

const isColorTexture = (value: string): boolean =>
  !/(?:_n|_msn|_s|_sk|_g|_glow|_e|_em|_m|_p)\.(?:dds|png|jpe?g)$/i.test(value);

const unique = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const nextFrame = (): Promise<void> => new Promise((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
  (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
};

const clearGroup = (group: THREE.Group): void => {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    }
  });
  group.clear();
};

const disposeMeshes = (meshes: THREE.Mesh[]): void => {
  meshes.forEach((mesh) => {
    mesh.geometry.dispose();
    disposeMaterial(mesh.material);
  });
};

const fitCameraToGroup = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls | null,
  group: THREE.Group
): void => {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) {
    return;
  }

  const frame = computeNifPreviewCameraFrame(box);
  camera.near = frame.near;
  camera.far = frame.far;
  camera.position.copy(frame.position);
  camera.lookAt(frame.target);
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.copy(frame.target);
    controls.update();
  }
};

const loadBrowserTexture = (
  buffer: ArrayBuffer,
  mimeType: string,
  anisotropy: number
): Promise<THREE.Texture> => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  new THREE.TextureLoader().load(
    objectUrl,
    (texture) => {
      URL.revokeObjectURL(objectUrl);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = false;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
      resolve(texture);
    },
    undefined,
    (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    }
  );
});

const canUploadCompressed = (
  format: ReturnType<typeof readDdsHeader>['format'],
  support: ReturnType<typeof detectDdsGpuSupport>
): boolean => {
  if (format === 'bc1' || format === 'bc2' || format === 'bc3') {
    return support.s3tc;
  }
  if (format === 'bc4' || format === 'bc5') {
    return support.rgtc;
  }
  return format === 'bc7' && support.bptc;
};

export const FilePreviewWorkspace = ({
  projectDirectory,
  initialModPath,
  initialRelativePath,
  initialFileName,
  initialProfileName,
  initialKind
}: FilePreviewWorkspaceProps) => {
  const { t } = useLocalization();
  const descriptor = previewKindById(initialKind);
  const previewTitle = t(descriptor.titleKey);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const animationRef = useRef<number | null>(null);
  const workerRef = useRef<NifPreviewWorkerClient | null>(null);
  const cacheRef = useRef<NifPreviewResourceCache | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const operationIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  if (!cacheRef.current) {
    cacheRef.current = new NifPreviewResourceCache();
  }

  const [variants, setVariants] = useState<FluxoraNifPreviewVariant[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [renderState, setRenderState] = useState<PreviewRenderState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const activeProfileName = initialProfileName || 'Default';
  const activeVariant = variants[activeIndex] ?? null;
  const visibleFileName = initialFileName || initialRelativePath.split(/[\\/]/).pop() || 'preview.nif';
  const sourceLabel = activeVariant?.modName || visibleFileName;
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < variants.length - 1;
  const variantPosition = variants.length ? `${activeIndex + 1} / ${variants.length}` : '0 / 0';
  const iconStyle = useMemo(
    () => ({ '--asset-icon': `url("${descriptor.icon}")` }) as CSSProperties,
    [descriptor.icon]
  );

  const logPerformance = useCallback((message: string) => {
    void window.fluxora.ui.log({
      level: 'info',
      category: 'NifPreview.Performance',
      message,
      operationId: operationIdRef.current ?? undefined
    });
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return undefined;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setRenderState('error');
      setMessage(t('preview.webglUnavailable'));
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101317);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const modelGroup = new THREE.Group();
    const ambient = new THREE.HemisphereLight(0xf7fbff, 0x18202a, 2.4);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    const fillLight = new THREE.DirectionalLight(0x8fb5ff, 0.9);
    const grid = new THREE.GridHelper(4, 16, 0x526170, 0x24303a);

    keyLight.position.set(3.5, 4.5, 5);
    fillLight.position.set(-4, 2.5, -2.5);
    grid.position.y = -0.5;
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.dataset.testid = 'file-preview-canvas';
    renderer.domElement.className = 'file-preview-canvas';

    scene.add(ambient, keyLight, fillLight, grid, modelGroup);
    host.appendChild(renderer.domElement);
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;
    modelGroupRef.current = modelGroup;

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animationRef.current = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
      resizeObserver.disconnect();
      clearGroup(modelGroup);
      controls.dispose();
      grid.geometry.dispose();
      disposeMaterial(grid.material);
      renderer.dispose();
      renderer.domElement.remove();
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      modelGroupRef.current = null;
    };
  }, [t]);

  useEffect(() => {
    const worker = new NifPreviewWorkerClient();
    workerRef.current = worker;
    return () => {
      worker.dispose();
      workerRef.current = null;
      cacheRef.current?.dispose();
    };
  }, []);

  const readAssetBytes = useCallback(async (
    sessionId: string,
    handle: FluxoraNifPreviewAssetHandle
  ): Promise<ArrayBuffer> => {
    const cache = cacheRef.current as NifPreviewResourceCache;
    const cached = cache.getRaw(handle.contentKey);
    if (cached) {
      return cached;
    }
    const bytes = await window.fluxora.mods.readNifPreviewAssetBytes(sessionId, handle.assetId);
    cache.setRaw(handle.contentKey, bytes);
    return bytes;
  }, []);

  const loadTexture = useCallback(async (
    sessionId: string,
    handle: FluxoraNifPreviewAssetHandle,
    generation: number
  ): Promise<THREE.Texture | null> => {
    const cache = cacheRef.current as NifPreviewResourceCache;
    const cached = cache.getTexture(handle.contentKey);
    if (cached) {
      return cached;
    }

    const renderer = rendererRef.current;
    const worker = workerRef.current;
    if (!renderer || !worker) {
      throw new Error(t('preview.rendererUnavailable'));
    }
    const support = detectDdsGpuSupport(renderer);
    const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    const srgb = isColorTexture(handle.relativePath);
    const bytes = await readAssetBytes(sessionId, handle);
    if (generation !== generationRef.current) {
      return null;
    }

    let texture: THREE.Texture;
    if (isDdsBuffer(bytes)) {
      const prepareStartedAt = performance.now();
      const header = readDdsHeader(bytes);
      if (canUploadCompressed(header.format, support)) {
        texture = createDdsPreviewTexture(bytes, { gpuSupport: support, anisotropy, srgb });
      } else if (header.format === 'bc7') {
        throw new Error(t('preview.bc7Unavailable'));
      } else {
        const transferable = cache.takeRaw(handle.contentKey) ?? bytes;
        const decoded = await worker.decodeDds(transferable, generation);
        if (decoded.generation !== generation || generation !== generationRef.current) {
          return null;
        }
        texture = createDecodedDdsPreviewTexture(decoded, { anisotropy, srgb });
      }
      logPerformance(
        `ddsPrepare relativePath=${handle.relativePath} format=${header.format} mipmaps=${header.mipMapCount} durationMs=${Math.round(performance.now() - prepareStartedAt)}`
      );
    } else {
      texture = await loadBrowserTexture(bytes, handle.mimeType, anisotropy);
    }

    cache.setTexture(handle.contentKey, texture);
    return texture;
  }, [logPerformance, readAssetBytes, t]);

  const prepareTextures = useCallback(async (
    sessionId: string,
    model: WorkerNifModel,
    modelRelativePath: string,
    meshes: THREE.Mesh[],
    generation: number,
    baseWarnings: string[]
  ): Promise<void> => {
    const bindings = new Map<string, THREE.Mesh[]>();
    const requestedPaths = new Map<string, string>();
    const nextWarnings = [...baseWarnings];
    model.meshes.forEach((mesh, index) => {
      const texturePath = selectNifPreviewTexturePath(mesh, model, modelRelativePath);
      if (!texturePath && model.texturePaths.length > 1) {
        nextWarnings.push(t('preview.textureMatch', { name: mesh.name }));
      }
      if (!texturePath) {
        return;
      }
      const key = pathKey(texturePath);
      requestedPaths.set(key, requestedPaths.get(key) ?? texturePath);
      const bound = bindings.get(key) ?? [];
      bound.push(meshes[index]);
      bindings.set(key, bound);
    });
    const texturePaths = deduplicateNifPreviewPaths(Array.from(requestedPaths.values()));
    if (!texturePaths.length || generation !== generationRef.current) {
      setWarnings(unique(nextWarnings));
      return;
    }

    const startedAt = performance.now();
    const batch = await window.fluxora.mods.prepareNifPreviewTextures(sessionId, texturePaths);
    if (generation !== generationRef.current) {
      return;
    }
    batch.missing.forEach((missing) => {
      nextWarnings.push(t('preview.textureMissing', { path: missing }));
    });

    await mapNifPreviewWithConcurrency(batch.assets, 3, async (handle) => {
      try {
        const texture = await loadTexture(sessionId, handle, generation);
        if (!texture || generation !== generationRef.current) {
          return;
        }
        (bindings.get(pathKey(handle.relativePath)) ?? []).forEach((mesh) => {
          const material = mesh.material as THREE.MeshStandardMaterial;
          material.map = texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        });
      } catch {
        nextWarnings.push(t('preview.textureDecode', { path: handle.relativePath }));
      }
    });

    if (generation === generationRef.current) {
      setWarnings(unique(nextWarnings));
      logPerformance(
        `texturesReady requested=${texturePaths.length} loaded=${batch.assets.length} missing=${batch.missing.length} durationMs=${Math.round(performance.now() - startedAt)}`
      );
    }
  }, [loadTexture, logPerformance, t]);

  const renderPreparedModel = useCallback(async (
    sessionId: string,
    handle: FluxoraNifPreviewAssetHandle,
    modelRelativePath: string,
    generation: number
  ): Promise<void> => {
    const group = modelGroupRef.current;
    const camera = cameraRef.current;
    const worker = workerRef.current;
    const cache = cacheRef.current as NifPreviewResourceCache;
    if (!group || !camera || !worker) {
      throw new Error(t('preview.rendererUnavailable'));
    }

    const modelStartedAt = performance.now();
    const bytes = await readAssetBytes(sessionId, handle);
    if (generation !== generationRef.current) {
      return;
    }
    const transferable = cache.takeRaw(handle.contentKey) ?? bytes;
    const parseStartedAt = performance.now();
    const parsed = await worker.parseNif(transferable, generation);
    logPerformance(
      `nifParse relativePath=${handle.relativePath} durationMs=${Math.round(performance.now() - parseStartedAt)} meshes=${parsed.model.meshes.length}`
    );
    if (parsed.generation !== generation || generation !== generationRef.current) {
      return;
    }

    const renderedMeshes: THREE.Mesh[] = [];
    let sliceStartedAt = performance.now();
    for (const mesh of parsed.model.meshes) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xaeb9c7,
        metalness: 0.04,
        roughness: 0.74,
        transparent: typeof mesh.alpha === 'number' && mesh.alpha < 1,
        opacity: mesh.alpha ?? 1,
        side: THREE.DoubleSide
      });
      const previewMesh = new THREE.Mesh(createNifPreviewGeometry(mesh), material);
      previewMesh.name = mesh.name;
      renderedMeshes.push(previewMesh);
      if (performance.now() - sliceStartedAt >= 8) {
        await nextFrame();
        sliceStartedAt = performance.now();
      }
      if (generation !== generationRef.current) {
        disposeMeshes(renderedMeshes);
        return;
      }
    }

    clearGroup(group);
    renderedMeshes.forEach((mesh) => group.add(mesh));
    fitCameraToGroup(camera, controlsRef.current, group);
    const localizedWarnings = parsed.model.warnings.map((warning) =>
      localizedNifPreviewWarning(warning, t)
    );
    setWarnings(unique(localizedWarnings));
    setRenderState('ready');
    setMessage(null);
    void nextFrame().then(() => {
      if (generation === generationRef.current) {
        logPerformance(
          `firstFrame relativePath=${handle.relativePath} durationMs=${Math.round(performance.now() - modelStartedAt)}`
        );
      }
    });

    void prepareTextures(
      sessionId,
      parsed.model,
      modelRelativePath,
      renderedMeshes,
      generation,
      localizedWarnings
    ).catch(() => {
      if (generation === generationRef.current) {
        setWarnings((current) => unique([
          ...current,
          t('preview.texturesPrepare')
        ]));
      }
    });
  }, [logPerformance, prepareTextures, readAssetBytes, t]);

  useEffect(() => {
    if (!projectDirectory || !initialRelativePath || !initialModPath) {
      setVariants([]);
      setRenderState('error');
      setMessage(t('preview.sourceUnavailable'));
      return undefined;
    }

    let cancelled = false;
    let ownedSessionId: string | null = null;
    const generation = nextNifPreviewGeneration(generationRef);
    const operationId = createPreviewOperationId();
    operationIdRef.current = operationId;
    cacheRef.current?.dispose();
    setRenderState('loading');
    setMessage(null);
    setWarnings([]);

    void window.fluxora.mods.startNifPreview(
      projectDirectory,
      activeProfileName,
      initialModPath,
      initialRelativePath,
      { operationId }
    ).then(async (result) => {
      ownedSessionId = result.sessionId;
      if (cancelled || generation !== generationRef.current) {
        await window.fluxora.mods.endNifPreview(result.sessionId);
        return;
      }
      sessionIdRef.current = result.sessionId;
      setVariants(result.variants);
      setActiveIndex(result.activeIndex);
      await renderPreparedModel(
        result.sessionId,
        result.modelHandle,
        result.variants[result.activeIndex]?.relativePath ?? initialRelativePath,
        generation
      );
    }).catch(() => {
      if (!cancelled && generation === generationRef.current) {
        setRenderState('error');
        setMessage(t('preview.startFailed'));
      }
    });

    return () => {
      cancelled = true;
      nextNifPreviewGeneration(generationRef);
      if (ownedSessionId) {
        void window.fluxora.mods.endNifPreview(ownedSessionId);
      }
      if (sessionIdRef.current === ownedSessionId) {
        sessionIdRef.current = null;
      }
    };
  }, [
    activeProfileName,
    initialModPath,
    initialRelativePath,
    projectDirectory,
    renderPreparedModel,
    t
  ]);

  const switchVariant = useCallback((nextIndex: number) => {
    const sessionId = sessionIdRef.current;
    const variant = variants[nextIndex];
    if (!sessionId || !variant || nextIndex === activeIndex) {
      return;
    }

    const generation = nextNifPreviewGeneration(generationRef);
    setActiveIndex(nextIndex);
    setRenderState('loading');
    setMessage(null);
    void window.fluxora.mods.prepareNifPreviewVariant(sessionId, variant.variantId)
      .then((handle) => renderPreparedModel(
        sessionId,
        handle,
        variant.relativePath || initialRelativePath,
        generation
      ))
      .catch(() => {
        if (generation === generationRef.current) {
          setRenderState('error');
          setMessage(t('preview.variantFailed'));
        }
      });
  }, [activeIndex, initialRelativePath, renderPreparedModel, t, variants]);

  return (
    <section className="file-preview-window" aria-label={previewTitle}>
      <header className="file-preview-header">
        <div className="file-preview-source" data-testid="file-preview-source-mod">
          <span>{t('preview.sourceMod')}</span>
          <strong>{sourceLabel}</strong>
        </div>
        <div className="file-preview-title">
          <span className="asset-icon file-preview-kind-icon" aria-hidden="true" style={iconStyle} />
          <h2>{previewTitle}</h2>
        </div>
        <div className="file-preview-nav">
          <button
            aria-label={t('preview.previousVariant')}
            className="icon-button"
            disabled={!canGoPrevious}
            onClick={() => switchVariant(Math.max(0, activeIndex - 1))}
            title={t('preview.previousVariant')}
            type="button"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span>{variantPosition}</span>
          <button
            aria-label={t('preview.nextVariant')}
            className="icon-button"
            disabled={!canGoNext}
            onClick={() => switchVariant(Math.min(variants.length - 1, activeIndex + 1))}
            title={t('preview.nextVariant')}
            type="button"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="file-preview-canvas-host" data-state={renderState} ref={canvasHostRef}>
        {message ? <span className="file-preview-status file-preview-status--error">{message}</span> : null}
      </div>

      <footer className="file-preview-footer">
        <span>{visibleFileName}</span>
        <span>{activeVariant?.relativePath || initialRelativePath}</span>
        <span>{activeVariant?.enabled === false ? t('preview.disabledMod') : activeProfileName}</span>
      </footer>

      {warnings.length ? (
        <ul className="file-preview-warnings" aria-label={t('preview.warnings')}>
          {warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </section>
  );
};
