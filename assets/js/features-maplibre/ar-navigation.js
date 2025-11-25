import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { state, elements, config } from './state.js';

// --- KONFIGURASI ---
const AR_HUD_ARROW_URL = 'assets/3DModel/arrow.glb'; 
const AR_TURN_ARROW_URL = 'assets/3DModel/turn-arrow.glb'; 
const AR_DEBUG = true;

// Offset Rotasi Model
const HUD_ARROW_OFFSET = 0; 
const TURN_ARROW_OFFSET = 40; 

const COMPASS_TURN_ANGLE_THRESHOLD = 25;
const TURN_DISTANCE_THRESHOLD = 15; // Meter
const TURN_ANGLE_THRESHOLD = 30;    // Derajat
const GROUND_ARROW_SPAWN_DIST = 10.0; 

// Variabel Global
let arSession = null;
let arRenderer = null; // Pastikan null di awal
let arScene = null;
let arCamera = null;
let arReticle = null;
let arHitTestSource = null;
let arLocalSpace = null;
let gltfLoader = new GLTFLoader();

// --- OBJEK AR (Disimpan global untuk referensi, tapi dibersihkan tiap sesi) ---
let hudArrowObject = null;    
let groundArrowObject = null; 
let isGroundArrowPlaced = false; 

// State Logic
let isTurnActive = false;
let turnBearing = 0;

// UI Elements
const arScanningText = document.getElementById('ar-scanning-text');
const arWrongWay = document.getElementById('ar-wrong-way');
const arDangerScreen = document.getElementById('ar-danger-screen'); 
let arMiniUserMarker = null;

// --- MINI MAP ---
function initMiniMap() {
    if (state.arMiniMap) return;
    
    const container = document.getElementById('ar-map-inner');
    if(!container) return;

    state.arMiniMap = new maplibregl.Map({
        container: 'ar-map-inner',
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`,
        center: state.userLocation || [config.lonmap, config.latmap],
        zoom: 18, pitch: 0, interactive: false, attributionControl: false
    });

    state.arMiniMap.on('load', () => {
        setTimeout(() => { state.arMiniMap.resize(); }, 100);
        if (state.currentRouteLine) updateMiniMapRoute(state.currentRouteLine);
        
        const markerEl = document.createElement('div');
        markerEl.className = 'user-location-marker'; 
        markerEl.innerHTML = `
            <div class="user-location-heading" style="transform: translate(-50%, -50%) rotate(0deg);"></div>
            <div class="user-location-dot"></div>
        `;
        arMiniUserMarker = new maplibregl.Marker({ element: markerEl, anchor: 'center', rotationAlignment: 'viewport' })
        .setLngLat(state.userLocation || [0,0])
        .addTo(state.arMiniMap);
    });
}

function updateMiniMapRoute(geoJSON) {
    if (!state.arMiniMap || !state.arMiniMap.loaded()) return;
    
    const source = state.arMiniMap.getSource('ar-route');
    
    if (source) {
        // Jika source sudah ada, update datanya
        source.setData(geoJSON);
    } else {
        // Jika source belum ada (misal sesi baru tapi map lama), buat baru
        state.arMiniMap.addSource('ar-route', { type: 'geojson', data: geoJSON });
        state.arMiniMap.addLayer({
            id: 'ar-route-line', type: 'line', source: 'ar-route',
            paint: { 'line-color': '#3b82f6', 'line-width': 5 }
        });
    }
}

// --- THREE.JS SETUP ---
function initARRenderer() {
    // 1. Safety Check: Jika renderer lama masih nyangkut, matikan dulu
    if (arRenderer) {
        console.warn("Renderer lama terdeteksi, membersihkan...");
        endARSession(); 
    }

    const container = elements.arContainer;
    const rect = container.getBoundingClientRect();

    // 2. Buat Renderer Baru
    arRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    arRenderer.setSize(rect.width, rect.height);
    arRenderer.xr.enabled = true;
    
    // 3. Masukkan Canvas ke DOM
    container.appendChild(arRenderer.domElement);
    
    // 4. Buat Scene Baru
    arScene = new THREE.Scene();
    arCamera = new THREE.PerspectiveCamera(70, rect.width / rect.height, 0.01, 20);
    arScene.add(arCamera); // Kamera wajib masuk scene

    // Lighting
    arScene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(0, 10, 5);
    arScene.add(dirLight);

    // Reticle
    const ringGeo = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });    
    arReticle = new THREE.Mesh(ringGeo, ringMat);
    arReticle.visible = false;
    arReticle.matrixAutoUpdate = false;
    arScene.add(arReticle);

    // 5. Load Model (Dengan Proteksi Duplikasi)
    loadArrows();
}

function loadArrows() {
    // PROTEKSI: Bersihkan referensi lama jika ada
    hudArrowObject = null;
    groundArrowObject = null;

    // 1. Load HUD Arrow
    gltfLoader.load(AR_HUD_ARROW_URL, (gltf) => {
        // Safety: Jika sesi sudah ditutup saat loading selesai, batalkan.
        if (!arCamera) return; 

        // Cek Duplikasi: Hapus jika sudah ada objek dengan nama sama di kamera
        const existingArrow = arCamera.getObjectByName('HUD_ARROW');
        if (existingArrow) arCamera.remove(existingArrow);

        hudArrowObject = gltf.scene.clone();
        hudArrowObject.name = 'HUD_ARROW'; // Beri nama untuk identifikasi
        
        // Setup Material
        hudArrowObject.traverse((child) => {
            if (child.isMesh) {
                child.userData.originalMaterial = child.material;
                child.userData.redMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff0000, depthTest: false, depthWrite: false
                });
                child.material.depthTest = false; 
                child.material.depthWrite = false;
                child.renderOrder = 999; 
            }
        });

        hudArrowObject.scale.set(0.08, 0.08, 0.08); 
        hudArrowObject.position.set(0, -0.15, -0.8); 
        hudArrowObject.userData.isRed = false;
        hudArrowObject.visible = false; 
        
        arCamera.add(hudArrowObject); // Tempel ke Kamera
    });

    // 2. Load Ground Arrow
    gltfLoader.load(AR_TURN_ARROW_URL, (gltf) => {
        if (!arScene) return; // Safety check

        // Cek Duplikasi: Hapus jika sudah ada di scene
        const existingTurn = arScene.getObjectByName('GROUND_ARROW');
        if (existingTurn) arScene.remove(existingTurn);

        groundArrowObject = gltf.scene.clone();
        groundArrowObject.name = 'GROUND_ARROW'; // Beri nama
        groundArrowObject.scale.set(0.8, 0.8, 0.8); 
        groundArrowObject.visible = false;
        
        arScene.add(groundArrowObject);
    });
}

export async function startARSession() {
    if (arSession) return; 
    if (!navigator.xr) { alert("WebXR tidak didukung."); return; }

    // Tampilkan UI AR
    elements.arContainer.style.display = 'block';
    elements.bottomNavbar.classList.add('translate-y-full'); 
    elements.arButton.style.display = 'none';
    elements.closeArButton.style.display = 'block';
    document.getElementById('ar-map-overlay').style.display = 'block';
    if (arScanningText) arScanningText.style.display = 'none'; 

    // --- SOLUSI DEFINITIF: HARD RESET MINI MAP ---
    // Cek jika map sudah ada dari sesi sebelumnya
    if (state.arMiniMap) {
        // Hancurkan map lama sepenuhnya!
        state.arMiniMap.remove(); 
        state.arMiniMap = null;   
        arMiniUserMarker = null;  // Reset marker juga
    }

    // Panggil init lagi. Karena state.arMiniMap sudah null, 
    // fungsi ini akan membuat map BARU dan memuat rute TERBARU (state.currentRouteLine)
    initMiniMap();
    // ---------------------------------------------

    initARRenderer();

    try {
        const session = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ["hit-test", "dom-overlay"],
            domOverlay: { root: elements.arContainer }
        });
        
        arSession = session;
        arRenderer.xr.setReferenceSpaceType("local");
        await arRenderer.xr.setSession(session);
        
        const refSpace = await session.requestReferenceSpace("local");
        const viewerSpace = await session.requestReferenceSpace("viewer");
        arLocalSpace = refSpace;
        arHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
        
        session.addEventListener("end", endARSession);
        
        arRenderer.setAnimationLoop(onARFrame);

    } catch (e) {
        console.error("Gagal memulai AR Session:", e);
        endARSession(); 
        alert("Gagal memulai AR. Pastikan browser mendukung WebXR/Chrome Android.");
    }
}

export function endARSession() {
    // 1. Matikan Session WebXR
    if (arSession) { 
        arSession.removeEventListener("end", endARSession);
        arSession.end().catch((e) => console.log("Session end error:", e));
        arSession = null; 
    }
    
    // 2. Matikan Loop & Bersihkan Renderer (SOLUSI MENTAL)
    if (arRenderer) {
        arRenderer.setAnimationLoop(null);
        
        // PENTING: Hapus elemen Canvas dari HTML secara manual
        if (arRenderer.domElement && arRenderer.domElement.parentNode) {
            arRenderer.domElement.parentNode.removeChild(arRenderer.domElement);
        }

        arRenderer.dispose(); // Hapus konteks WebGL
        arRenderer = null;    // Reset variabel
    }

    // 3. Reset Variabel Scene & Objek
    arScene = null;
    arCamera = null;
    arReticle = null;
    arHitTestSource = null;
    arLocalSpace = null;

    hudArrowObject = null;
    groundArrowObject = null;

    // 4. Reset UI
    elements.arContainer.style.display = 'none';
    elements.arButton.style.display = 'flex';
    elements.closeArButton.style.display = 'none';
    
    if (!state.isNavigating && elements.bottomNavbar) {
        elements.bottomNavbar.classList.remove('translate-y-full');
    }
    
    if (arScanningText) arScanningText.style.display = 'none';
    if (arWrongWay) arWrongWay.style.display = 'none';
    if (arDangerScreen) arDangerScreen.style.display = 'none';
    
    // Reset Logic Flags
    isGroundArrowPlaced = false; 
    isTurnActive = false;
    
    console.log("AR Session Cleaned Successfully.");
}

function onARFrame(time, frame) {
    const session = frame.session;
    if (!session) return;

    // Update Mini Map
    if (state.arMiniMap && state.userLocation) {
        state.arMiniMap.setCenter(state.userLocation);
        state.arMiniMap.setBearing(state.smoothedAlpha || 0);
        if (arMiniUserMarker) arMiniUserMarker.setLngLat(state.userLocation);
    }

    checkNavigationStatus();
    updateHUDArrow();
    updateGroundArrow(frame);

    // Render Scene
    if(arRenderer && arScene && arCamera) {
        arRenderer.render(arScene, arCamera);
    }
}

// --- LOGIK NAVIGASI ---

function checkNavigationStatus() {
    if (!state.currentRouteLine || !state.userLocation) return;

    const userPt = turf.point(state.userLocation);
    const line = state.currentRouteLine;
    const snapped = turf.nearestPointOnLine(line, userPt);
    const currentIdx = snapped.properties.index;
    const coords = line.coordinates;

    let turnFoundInLoop = false;

    // Loop cari belokan di depan
    for (let i = currentIdx; i < Math.min(currentIdx + 4, coords.length - 2); i++) {
        const p1 = coords[i];
        const p2 = coords[i+1];
        const p3 = coords[i+2];

        const bearing1 = turf.bearing(turf.point(p1), turf.point(p2));
        const bearing2 = turf.bearing(turf.point(p2), turf.point(p3));
        let angleDiff = Math.abs(bearing1 - bearing2);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        if (angleDiff > TURN_ANGLE_THRESHOLD) {
            const distToTurn = turf.distance(userPt, turf.point(p2), { units: 'kilometers' }) * 1000;

            if (distToTurn < TURN_DISTANCE_THRESHOLD) {
                if (!isTurnActive) {
                    isTurnActive = true;
                    isGroundArrowPlaced = false; 
                    turnBearing = (bearing2 + 360) % 360; 
                }
                turnFoundInLoop = true;
                return; // Stop mencari jika sudah ketemu yang terdekat
            }
        }
    }

    if (!turnFoundInLoop && isTurnActive) {
        isTurnActive = false;
        isGroundArrowPlaced = false; 
        if (groundArrowObject) groundArrowObject.visible = false;
        if (arReticle) arReticle.visible = false;
    }
}

function updateHUDArrow() {
    if (!hudArrowObject) return;
    hudArrowObject.visible = true;

    const targetBearing = getGeneralDirection();
    const currentHeading = state.smoothedAlpha || 0;

    if (targetBearing !== null) {
        let angleDiff = targetBearing - currentHeading;
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;

        // UI Salah Arah
        const WRONG_WAY_THRESHOLD = 100;
        if (Math.abs(angleDiff) > WRONG_WAY_THRESHOLD) {
            if (arWrongWay) arWrongWay.style.display = 'flex';
            if (arDangerScreen) arDangerScreen.style.display = 'block';

            if (!hudArrowObject.userData.isRed) {
                hudArrowObject.traverse((c) => { if (c.isMesh && c.userData.redMaterial) c.material = c.userData.redMaterial; });
                hudArrowObject.userData.isRed = true;
            }
        } else {
            if (arWrongWay) arWrongWay.style.display = 'none';
            if (arDangerScreen) arDangerScreen.style.display = 'none';

            if (hudArrowObject.userData.isRed) {
                hudArrowObject.traverse((c) => { if (c.isMesh && c.userData.originalMaterial) c.material = c.userData.originalMaterial; });
                hudArrowObject.userData.isRed = false;
            }
        }

        // Animasi Rotasi
        const targetQuaternion = new THREE.Quaternion();
        const baseRotation = new THREE.Euler(0, 0, 0, 'YXZ');
        
        const defaultTilt = 40; 
        let tiltFactor = Math.cos(THREE.MathUtils.degToRad(angleDiff / 2));
        let dynamicTilt = defaultTilt * Math.abs(tiltFactor);
        if (dynamicTilt < 10) dynamicTilt = 10; 

        baseRotation.x = THREE.MathUtils.degToRad(dynamicTilt); 
        baseRotation.y = THREE.MathUtils.degToRad(-angleDiff + HUD_ARROW_OFFSET);

        targetQuaternion.setFromEuler(baseRotation);
        hudArrowObject.quaternion.slerp(targetQuaternion, 0.15);
    }
}

function updateGroundArrow(frame) {
    if (!groundArrowObject || !arHitTestSource) return;

    if (!isTurnActive) {
        groundArrowObject.visible = false;
        arReticle.visible = false;
        if (arScanningText) arScanningText.style.display = 'none';
        return;
    }

    if (isGroundArrowPlaced) {
        groundArrowObject.visible = true; 
        arReticle.visible = false; 
        if (arScanningText) arScanningText.style.display = 'none';
        return; 
    }

    const hitTestResults = frame.getHitTestResults(arHitTestSource);
    if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(arLocalSpace);

        const rot = new THREE.Matrix4().extractRotation(new THREE.Matrix4().fromArray(pose.transform.matrix));
        const normal = new THREE.Vector3(0, 1, 0).applyMatrix4(rot);
        const angle = normal.angleTo(new THREE.Vector3(0, 1, 0)) * (180/Math.PI);

        if (angle < 10) { 
            arReticle.visible = true;
            arReticle.matrix.fromArray(pose.transform.matrix);

            const camPos = new THREE.Vector3();
            const camQuat = new THREE.Quaternion();
            arCamera.getWorldPosition(camPos);
            arCamera.getWorldQuaternion(camQuat);

            const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
            forwardDir.y = 0; 
            forwardDir.normalize();

            const spawnPos = camPos.clone().add(forwardDir.multiplyScalar(GROUND_ARROW_SPAWN_DIST));
            const reticlePos = new THREE.Vector3().setFromMatrixPosition(arReticle.matrix);
            spawnPos.y = reticlePos.y; 

            groundArrowObject.position.copy(spawnPos);
            groundArrowObject.visible = true;

            const currentHeading = state.smoothedAlpha || 0;
            let turnDiff = turnBearing - currentHeading;
            if (turnDiff > 180) turnDiff -= 360;
            if (turnDiff < -180) turnDiff += 360;

            const camEuler = new THREE.Euler().setFromQuaternion(camQuat, 'YXZ');
            groundArrowObject.rotation.set(0, camEuler.y + THREE.MathUtils.degToRad(-turnDiff + TURN_ARROW_OFFSET), 0);

            isGroundArrowPlaced = true; 
            arReticle.visible = false; 
            if (arScanningText) arScanningText.style.display = 'none';
        }
    } else {
        arReticle.visible = false;
        if (arScanningText) {
            arScanningText.style.display = 'flex';
            arScanningText.innerText = "⚠️ Belokan! Arahkan ke lantai...";
        }
    }
}

function getGeneralDirection() {
    if (!state.currentRouteLine || !state.userLocation) return null;

    const userPt = turf.point(state.userLocation);
    const line = state.currentRouteLine;
    const coords = line.coordinates;

    const snapped = turf.nearestPointOnLine(line, userPt);
    const currentIdx = snapped.properties.index;

    for (let i = currentIdx; i < coords.length - 2; i++) {
        const p1 = coords[i];
        const p2 = coords[i+1];
        const p3 = coords[i+2];

        const bearing1 = turf.bearing(turf.point(p1), turf.point(p2));
        const bearing2 = turf.bearing(turf.point(p2), turf.point(p3));

        let angleDiff = Math.abs(bearing1 - bearing2);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        if (angleDiff > COMPASS_TURN_ANGLE_THRESHOLD) {
            return (turf.bearing(userPt, turf.point(p2)) + 360) % 360;
        }
    }

    const lastCoord = coords[coords.length - 1];
    return (turf.bearing(userPt, turf.point(lastCoord)) + 360) % 360;
}