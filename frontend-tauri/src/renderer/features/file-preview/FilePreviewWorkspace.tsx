import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type {
  FluxoraPreviewAsset,
  FluxoraPreviewVariant,
  FluxoraProject
} from '../../../shared/fluxora-api';
import { createDdsPreviewTexture, isDdsBuffer } from './dds-texture';
import {
  createNifPreviewGeometry,
  selectNifPreviewTexturePath
} from './nif-preview-rendering';
import { parseNifModel } from './nif-parser';
import { previewKindById } from './preview-kind-registry';

interface FilePreviewWorkspaceProps {
  project: FluxoraProject | null;
  initialModPath: string;
  initialRelativePath: string;
  initialFileName: string;
  initialProfileName: string;
  initialKind: string;
}

type PreviewLoadState = 'idle' | 'loading' | 'ready' | 'error';

const createPreviewOperationId = (scope: string): string =>
  `op_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${scope}_${Math.random()
    .toString(16)
    .slice(2, 10)}`;

const base64ToArrayBuffer = (contentBase64: string): ArrayBuffer => {
  if (!contentBase64) {
    return new ArrayBuffer(0);
  }

  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const textureMimeType = (asset: FluxoraPreviewAsset): string => {
  if (asset.mimeType) {
    return asset.mimeType;
  }

  const lowerName = asset.fileName.toLowerCase();
  if (lowerName.endsWith('.dds')) {
    return 'image/vnd-ms.dds';
  }
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  return 'image/png';
};

const loadTextureAsset = (asset: FluxoraPreviewAsset): Promise<THREE.Texture> =>
  new Promise((resolve, reject) => {
    if (!asset.contentBase64) {
      reject(new Error('Texture asset was empty.'));
      return;
    }

    const buffer = base64ToArrayBuffer(asset.contentBase64);
    if (isDdsBuffer(buffer)) {
      try {
        const texture = createDdsPreviewTexture(buffer);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        texture.needsUpdate = true;
        resolve(texture);
      } catch (error) {
        reject(error);
      }
      return;
    }

    const source = `data:${textureMimeType(asset)};base64,${asset.contentBase64}`;
    const loader = new THREE.TextureLoader();
    loader.load(
      source,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      reject
    );
  });

const disposeMaterial = (
  material: THREE.Material | THREE.Material[],
  disposedTextures = new Set<THREE.Texture>()
) => {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => {
    const textured = item as THREE.Material & {
      map?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
    };
    [textured.map, textured.normalMap, textured.roughnessMap].forEach((texture) => {
      if (texture && !disposedTextures.has(texture)) {
        disposedTextures.add(texture);
        texture.dispose();
      }
    });
    item.dispose();
  });
};

const clearGroup = (group: THREE.Group) => {
  const disposedTextures = new Set<THREE.Texture>();
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      disposeMaterial(mesh.material, disposedTextures);
    }
  });
  group.clear();
};

const fitCameraToGroup = (
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls | null,
  group: THREE.Group
) => {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) {
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const radius = Math.max(size.x, size.y, size.z, 1);
  camera.near = Math.max(radius / 100, 0.01);
  camera.far = Math.max(radius * 100, 100);
  camera.position.set(center.x + radius * 1.25, center.y + radius * 0.85, center.z + radius * 1.75);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
};

const fallbackVariant = (
  modPath: string,
  fileName: string,
  relativePath: string
): FluxoraPreviewVariant => ({
  modPath,
  modName: fileName || 'Preview source',
  order: 0,
  enabled: true,
  relativePath,
  size: 0
});

export const FilePreviewWorkspace = ({
  project,
  initialModPath,
  initialRelativePath,
  initialFileName,
  initialProfileName,
  initialKind
}: FilePreviewWorkspaceProps) => {
  const descriptor = previewKindById(initialKind);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const animationRef = useRef<number | null>(null);
  const [variants, setVariants] = useState<FluxoraPreviewVariant[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [modelAsset, setModelAsset] = useState<FluxoraPreviewAsset | null>(null);
  const [loadState, setLoadState] = useState<PreviewLoadState>('idle');
  const [renderState, setRenderState] = useState<PreviewLoadState>('idle');
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
    () =>
      ({
        '--asset-icon': `url("${descriptor.icon}")`
      }) as CSSProperties,
    [descriptor.icon]
  );

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
      setMessage('WebGL is unavailable for this preview window.');
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
    renderer.setClearColor(0x101317, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.dataset.testid = 'file-preview-canvas';
    renderer.domElement.className = 'file-preview-canvas';

    scene.add(ambient, keyLight, fillLight, grid, modelGroup);
    host.appendChild(renderer.domElement);
    sceneRef.current = scene;
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
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      modelGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!project || !initialRelativePath || !initialModPath) {
      setVariants([]);
      setLoadState('error');
      setMessage('Preview source is unavailable.');
      return;
    }

    let cancelled = false;
    setLoadState('loading');
    setMessage(null);
    setWarnings([]);
    void window.fluxora.mods
      .listPreviewVariants(project.projectDirectory, activeProfileName, initialRelativePath, {
        operationId: createPreviewOperationId('mods_list_preview_variants')
      })
      .then((items) => {
        if (cancelled) {
          return;
        }
        const nextVariants = items.length
          ? items
          : [fallbackVariant(initialModPath, visibleFileName, initialRelativePath)];
        const clickedIndex = Math.max(
          nextVariants.findIndex((item) => item.modPath === initialModPath),
          0
        );
        setVariants(nextVariants);
        setActiveIndex(clickedIndex);
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setVariants([fallbackVariant(initialModPath, visibleFileName, initialRelativePath)]);
        setActiveIndex(0);
        setLoadState('error');
        setMessage(error instanceof Error ? error.message : 'Preview variants could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [activeProfileName, initialModPath, initialRelativePath, project, visibleFileName]);

  useEffect(() => {
    if (!project || !activeVariant) {
      setModelAsset(null);
      return;
    }

    let cancelled = false;
    setLoadState('loading');
    setMessage(null);
    void window.fluxora.mods
      .readPreviewAsset(
        project.projectDirectory,
        activeProfileName,
        activeVariant.modPath,
        activeVariant.relativePath || initialRelativePath,
        'nif',
        { operationId: createPreviewOperationId('mods_read_preview_asset') }
      )
      .then((asset) => {
        if (cancelled) {
          return;
        }
        setModelAsset(asset);
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setModelAsset(null);
        setLoadState('error');
        setMessage(error instanceof Error ? error.message : 'Preview asset could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [activeProfileName, activeVariant, initialRelativePath, project]);

  useEffect(() => {
    const group = modelGroupRef.current;
    const camera = cameraRef.current;
    if (!group || !camera || !project || !activeVariant || !modelAsset) {
      return undefined;
    }

    let cancelled = false;
    setRenderState('loading');
    setMessage(null);

    const applyModel = async () => {
      const parsed = parseNifModel(base64ToArrayBuffer(modelAsset.contentBase64));
      const nextWarnings = [...parsed.warnings];
      const textureCache = new Map<string, THREE.Texture | null>();
      const modelRelativePath = modelAsset.relativePath || activeVariant.relativePath || initialRelativePath;

      const textureForPath = async (texturePath: string): Promise<THREE.Texture | null> => {
        if (textureCache.has(texturePath)) {
          return textureCache.get(texturePath) ?? null;
        }

        let texture: THREE.Texture | null = null;
        try {
          const textureAsset = await window.fluxora.mods.readPreviewAsset(
            project.projectDirectory,
            activeProfileName,
            activeVariant.modPath,
            texturePath,
            'texture',
            { operationId: createPreviewOperationId('mods_read_preview_texture') }
          );
          texture = await loadTextureAsset(textureAsset);
        } catch {
          nextWarnings.push(`Texture not found or could not be decoded: ${texturePath}`);
        }
        textureCache.set(texturePath, texture);
        return texture;
      };

      const renderedMeshes: THREE.Mesh[] = [];
      for (const mesh of parsed.meshes) {
        const texturePath = selectNifPreviewTexturePath(mesh, parsed, modelRelativePath);
        if (!texturePath && parsed.texturePaths.length > 1) {
          nextWarnings.push(`Texture could not be matched confidently for ${mesh.name}.`);
        }

        const texture = texturePath ? await textureForPath(texturePath) : null;
        const material = new THREE.MeshStandardMaterial({
          color: texture ? 0xffffff : 0xaeb9c7,
          map: texture,
          metalness: 0.04,
          roughness: 0.74,
          transparent: typeof mesh.alpha === 'number' && mesh.alpha < 1,
          opacity: mesh.alpha ?? 1,
          side: THREE.DoubleSide
        });
        const previewMesh = new THREE.Mesh(createNifPreviewGeometry(mesh), material);
        previewMesh.name = mesh.name;
        renderedMeshes.push(previewMesh);
      }

      if (cancelled) {
        const disposedTextures = new Set<THREE.Texture>();
        Array.from(new Set(textureCache.values())).forEach((texture) => {
          if (texture) {
            disposedTextures.add(texture);
            texture.dispose();
          }
        });
        renderedMeshes.forEach((mesh) => {
          mesh.geometry.dispose();
          disposeMaterial(mesh.material, disposedTextures);
        });
        return;
      }

      clearGroup(group);
      renderedMeshes.forEach((mesh) => group.add(mesh));

      fitCameraToGroup(camera, controlsRef.current, group);
      setWarnings(Array.from(new Set(nextWarnings)));
      setRenderState('ready');
    };

    void applyModel().catch((error) => {
      if (cancelled) {
        return;
      }
      setRenderState('error');
      setMessage(error instanceof Error ? error.message : 'Model could not be rendered.');
    });

    return () => {
      cancelled = true;
    };
  }, [activeProfileName, activeVariant, modelAsset, project]);

  const goPrevious = () => {
    setActiveIndex((current) => Math.max(0, current - 1));
  };

  const goNext = () => {
    setActiveIndex((current) => Math.min(variants.length - 1, current + 1));
  };

  return (
    <section className="file-preview-window" aria-label={descriptor.title}>
      <header className="file-preview-header">
        <div className="file-preview-source" data-testid="file-preview-source-mod">
          <span>Source mod</span>
          <strong>{sourceLabel}</strong>
        </div>
        <div className="file-preview-title">
          <span className="asset-icon file-preview-kind-icon" aria-hidden="true" style={iconStyle} />
          <h2>{descriptor.title}</h2>
        </div>
        <div className="file-preview-nav">
          <button
            aria-label="Previous mod variant"
            className="icon-button"
            disabled={!canGoPrevious}
            onClick={goPrevious}
            title="Previous mod variant"
            type="button"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span>{variantPosition}</span>
          <button
            aria-label="Next mod variant"
            className="icon-button"
            disabled={!canGoNext}
            onClick={goNext}
            title="Next mod variant"
            type="button"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="file-preview-canvas-host" data-state={renderState} ref={canvasHostRef}>
        {loadState === 'loading' || renderState === 'loading' ? (
          <span className="file-preview-status">Loading preview</span>
        ) : null}
        {message ? <span className="file-preview-status file-preview-status--error">{message}</span> : null}
      </div>

      <footer className="file-preview-footer">
        <span>{visibleFileName}</span>
        <span>{activeVariant?.relativePath || initialRelativePath}</span>
        <span>{activeVariant?.enabled === false ? 'Disabled mod' : activeProfileName}</span>
      </footer>

      {warnings.length ? (
        <ul className="file-preview-warnings" aria-label="Preview warnings">
          {warnings.slice(0, 4).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
