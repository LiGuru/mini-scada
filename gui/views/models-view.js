/**
 * models-view.js — Three.js STEP/IGES 3D viewer.
 *
 * Dependencies loaded before this module (see index.html):
 *   • Three.js      — via importmap  ("three" → node_modules/three/build/three.module.js)
 *   • occt-import-js — loaded as a <script> tag, exposes window.occtimportjs global
 *
 * Public API:
 *   initModelsView()                          — call once when the Models tab is first shown
 *   loadStep()                                — open file dialog → parse → add to scene
 *   loadStepBuffer(name, arrayBuffer, path)   — used when re-loading from a project file
 *   removeModel(id)                           — remove one model
 *   clearModels()                             — remove all
 *   getModels()                               — [{id, name, path, color, visible}]
 *
 * On Linux, the packaged WASM is unpacked via asarUnpack in package.json so
 * file:// references into node_modules still resolve correctly.
 */

import * as THREE           from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { t }                from '../i18n.js?v=1';

// ── State ─────────────────────────────────────────────────────────

const _models  = [];   // { id, name, path, color, visible, _group }
let _scene, _camera, _renderer, _controls;
let _initialized   = false;
let _occt          = null;
let _occtReady     = false;
let _occtFailed    = false;
let _animFrameId   = null;

const MODEL_COLORS = ['#00bcd4', '#00c896', '#f0a500', '#a78bfa', '#f472b6'];

// ── Public API ────────────────────────────────────────────────────

/**
 * Call once when the Models tab is first activated.
 * Safe to call multiple times — initialises only once.
 */
export async function initModelsView() {
    if (_initialized) {
        // Re-render in case config changed while the tab was hidden
        _renderModelList();
        if (_renderer) _renderer.render(_scene, _camera);
        return;
    }
    _initialized = true;

    _initScene();
    _startRenderLoop();
    _renderModelList();

    // Initialise OCCT asynchronously; show status in sidebar while loading.
    _setStatus(t('models.wasmInit'));
    _initOcct().then(() => {
        _setStatus('');
    }).catch((err) => {
        _setStatus(t('models.wasmFail'));
        console.error('[Models] OCCT init failed:', err);
    });
}

/** Open a STEP file via native dialog, parse, and add to scene. */
export async function loadStep() {
    if (!window.electronAPI?.openStep) return;

    const result = await window.electronAPI.openStep();
    if (!result) return;   // dialog cancelled

    await loadStepBuffer(result.name, result.buffer, result.path);
}

/**
 * Parse an ArrayBuffer as a STEP file and add the resulting mesh to the scene.
 * Called from loadStep() and when re-loading models from a .scada project.
 *
 * @param {string}      name         Filename shown in the sidebar.
 * @param {ArrayBuffer} arrayBuffer  Raw STEP file bytes.
 * @param {string}      filePath     Original file path (persisted in project).
 * @returns {object|null}  The model entry, or null on failure.
 */
export async function loadStepBuffer(name, arrayBuffer, filePath) {
    if (!_occtReady) {
        // OCCT might still be initialising — wait up to 10 s
        await _waitOcct(10_000);
    }
    if (!_occtReady || _occtFailed) {
        _setStatus(t('models.wasmFail'));
        return null;
    }

    _setStatus(t('models.loading'));
    _setLoading(true);

    try {
        const fileContent = new Uint8Array(arrayBuffer);
        const result      = _occt.ReadStepFile(fileContent, null);

        if (!result.success) {
            throw new Error(`OCCT reported failure (mesh count: ${result.meshCount})`);
        }

        const id      = `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const color   = MODEL_COLORS[_models.length % MODEL_COLORS.length];
        const group   = new THREE.Group();
        group.name    = id;

        // API: mesh.attributes.position.array (Float32Array)
        //      mesh.attributes.normal?.array   (Float32Array, may be absent)
        //      mesh.index.array                (Uint32Array)
        //      mesh.color                      ([r, g, b] 0-1, or null)
        for (const mesh of result.meshes) {
            if (!mesh.attributes?.position || !mesh.index) continue;

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position',
                new THREE.BufferAttribute(mesh.attributes.position.array, 3));

            if (mesh.attributes.normal?.array?.length > 0) {
                geo.setAttribute('normal',
                    new THREE.BufferAttribute(mesh.attributes.normal.array, 3));
            } else {
                geo.computeVertexNormals();
            }
            geo.setIndex(new THREE.BufferAttribute(mesh.index.array, 1));

            // Prefer per-mesh colour embedded in the STEP file; fall back to
            // the auto-assigned palette colour for this model.
            const meshColor = Array.isArray(mesh.color)
                ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
                : new THREE.Color(color);

            const mat = new THREE.MeshPhongMaterial({
                color:     meshColor,
                specular:  new THREE.Color(0x333333),
                shininess: 40,
                side:      THREE.DoubleSide,
            });
            group.add(new THREE.Mesh(geo, mat));
        }

        _scene.add(group);
        _fitCamera(group);

        const entry = { id, name, path: filePath, color, visible: true, _group: group };
        _models.push(entry);
        _renderModelList();
        _setStatus('');
        return entry;

    } catch (err) {
        _setStatus(t('models.parseError', { name }));
        console.error('[Models] Failed to load STEP:', err);
        return null;
    } finally {
        _setLoading(false);
    }
}

export function removeModel(id) {
    const idx = _models.findIndex(m => m.id === id);
    if (idx === -1) return;
    const [entry] = _models.splice(idx, 1);
    _scene.remove(entry._group);
    _disposeGroup(entry._group);
    _renderModelList();
}

export function clearModels() {
    for (const entry of _models) {
        _scene.remove(entry._group);
        _disposeGroup(entry._group);
    }
    _models.length = 0;
    _renderModelList();
}

/** Returns serialisable model list (no Three.js objects). */
export function getModels() {
    return _models.map(({ id, name, path, color, visible }) =>
        ({ id, name, path, color, visible }));
}

export function setModelColor(id, color) {
    const entry = _models.find(m => m.id === id);
    if (!entry) return;
    entry.color = color;
    entry._group.traverse(child => {
        if (child.isMesh) child.material.color.set(color);
    });
}

export function setModelVisible(id, visible) {
    const entry = _models.find(m => m.id === id);
    if (!entry) return;
    entry.visible        = visible;
    entry._group.visible = visible;
}

// ── Scene setup ───────────────────────────────────────────────────

function _initScene() {
    const wrap = document.getElementById('models-canvas-wrap');
    if (!wrap) return;

    // Renderer
    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(wrap.clientWidth || 800, wrap.clientHeight || 600);
    _syncBgColor();
    wrap.appendChild(_renderer.domElement);

    // Scene
    _scene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    _scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(100, 200, 150);
    _scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-100, -50, -100);
    _scene.add(fill);

    // Grid helper — use theme CSS vars for colours
    const gridPrimary   = _cssVar('--border')  || '#1a2030';
    const gridSecondary = _cssVar('--border2') || '#242b3d';
    _scene.add(new THREE.GridHelper(400, 40,
        new THREE.Color(gridPrimary),
        new THREE.Color(gridSecondary)));

    // Camera
    _camera = new THREE.PerspectiveCamera(45,
        (wrap.clientWidth || 800) / (wrap.clientHeight || 600), 0.01, 50_000);
    _camera.position.set(200, 150, 200);

    // Orbit controls
    _controls = new OrbitControls(_camera, _renderer.domElement);
    _controls.enableDamping  = true;
    _controls.dampingFactor  = 0.06;
    _controls.panSpeed       = 0.8;
    _controls.zoomSpeed      = 1.2;

    // Responsive resize
    const ro = new ResizeObserver(() => {
        if (!_renderer || !_camera) return;
        const w = wrap.clientWidth, h = wrap.clientHeight;
        _camera.aspect = w / h;
        _camera.updateProjectionMatrix();
        _renderer.setSize(w, h);
    });
    ro.observe(wrap);

    // Update background when theme changes
    document.addEventListener('scada:themechange', _syncBgColor);
}

function _syncBgColor() {
    if (!_renderer) return;
    const bg = _cssVar('--bg') || '#0b0e14';
    _renderer.setClearColor(new THREE.Color(bg));
}

function _cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function _startRenderLoop() {
    const tick = () => {
        _animFrameId = requestAnimationFrame(tick);
        if (_controls) _controls.update();
        if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
    };
    tick();
}

// ── OCCT ─────────────────────────────────────────────────────────

async function _initOcct() {
    if (!window.occtimportjs) throw new Error('occt-import-js global not found');

    // Resolve the WASM file path relative to index.html.
    // In the packaged app the WASM is in app.asar.unpacked via asarUnpack.
    const base = window.location.href.replace(/\/[^/]*$/, '/');
    const wasmBase = base.includes('.asar/')
        ? base.replace('.asar/', '.asar.unpacked/')
        : base;

    _occt = await window.occtimportjs({
        locateFile: (name) => `${wasmBase}node_modules/occt-import-js/dist/${name}`,
    });
    _occtReady = true;
}

function _waitOcct(timeoutMs) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const check = () => {
            if (_occtReady || _occtFailed) return resolve();
            if (Date.now() > deadline) return reject(new Error('OCCT init timeout'));
            setTimeout(check, 200);
        };
        check();
    });
}

// ── Camera helpers ────────────────────────────────────────────────

function _fitCamera(object) {
    const box    = new THREE.Box3().setFromObject(object);
    const size   = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());

    _controls.reset();
    _camera.near   = size / 100;
    _camera.far    = size * 100;
    _camera.updateProjectionMatrix();

    const fov = _camera.fov * (Math.PI / 180);
    const dist = Math.abs(size / Math.sin(fov / 2)) * 0.6;

    _camera.position.copy(center);
    _camera.position.x += dist;
    _camera.position.y += dist * 0.5;
    _camera.position.z += dist;
    _controls.target.copy(center);
    _controls.update();
}

// ── Geometry disposal ─────────────────────────────────────────────

function _disposeGroup(group) {
    group.traverse(child => {
        if (!child.isMesh) return;
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
        } else {
            child.material?.dispose();
        }
    });
}

// ── Sidebar UI ────────────────────────────────────────────────────

function _renderModelList() {
    const list = document.getElementById('modelsList');
    if (!list) return;

    if (_models.length === 0) {
        list.innerHTML = `<div class="models-empty" data-i18n="models.empty">${t('models.empty')}</div>`;
        return;
    }

    list.innerHTML = _models.map(m => `
        <div class="model-row" data-id="${m.id}">
            <button class="model-vis-btn ${m.visible ? 'visible' : 'hidden'}"
                    data-action="vis" data-id="${m.id}"
                    title="${m.visible ? 'Hide' : 'Show'}">
                <i class="fas fa-eye${m.visible ? '' : '-slash'}"></i>
            </button>
            <input type="color" class="model-color-swatch"
                   data-action="color" data-id="${m.id}"
                   value="${m.color}" title="Model colour">
            <span class="model-name" title="${m.path}">${m.name}</span>
            <button class="model-remove-btn"
                    data-action="remove" data-id="${m.id}"
                    title="${t('models.remove')}">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');

    // Delegate events
    list.querySelectorAll('[data-action]').forEach(el => {
        const action = el.dataset.action;
        const id     = el.dataset.id;
        if (action === 'vis') {
            el.addEventListener('click', () => {
                const m = _models.find(x => x.id === id);
                if (!m) return;
                setModelVisible(id, !m.visible);
                _renderModelList();
            });
        } else if (action === 'color') {
            el.addEventListener('input', () => setModelColor(id, el.value));
        } else if (action === 'remove') {
            el.addEventListener('click', () => removeModel(id));
        }
    });
}

function _setStatus(msg) {
    const el = document.getElementById('modelsStatus');
    if (el) el.textContent = msg;
}

function _setLoading(on) {
    const el = document.getElementById('modelsLoading');
    if (el) el.style.display = on ? 'flex' : 'none';
}
