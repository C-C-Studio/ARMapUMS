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
const TURN_DISTANCE_THRESHOLD = 25; // Jarak deteksi belokan (Meter) - Disesuaikan agar UI muncul lebih awal
const TURN_ANGLE_THRESHOLD = 30;    // Derajat
const GROUND_ARROW_SPAWN_DIST = 10.0; 

// Variabel Global
let arSession = null;
let arRenderer = null; 
let arScene = null;
let arCamera = null;
let arReticle = null;
let arHitTestSource = null;
let arLocalSpace = null;
let gltfLoader = new GLTFLoader();

// --- OBJEK AR ---
let hudArrowObject = null;    
let groundArrowObject = null; 
let isGroundArrowPlaced = false; 

// State Logic
let isTurnActive = false;
let turnBearing = 0;

// UI Elements (EXISTING)
const arScanningText = document.getElementById('ar-scanning-text');
const arWrongWay = document.getElementById('ar-wrong-way');
const arDangerScreen = document.getElementById('ar-danger-screen'); 
let arMiniUserMarker = null;

// --- NEW UI ELEMENTS (TURN BAR) ---
const arTurnIndicator = document.getElementById('ar-turn-indicator');
const arTurnIcon = document.getElementById('ar-turn-icon');
const arTurnDistance = document.getElementById('ar-turn-distance');
const arTurnInstruction = document.getElementById('ar-turn-instruction');


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
        source.setData(geoJSON);
    } else {
        state.arMiniMap.addSource('ar-route', { type: 'geojson', data: geoJSON });
        state.arMiniMap.addLayer({
            id: 'ar-route-line', type: 'line', source: 'ar-route',
            paint: { 'line-color': '#3b82f6', 'line-width': 5 }
        });
    }
}

// --- THREE.JS SETUP ---
function initARRenderer() {
    if (arRenderer) {
        console.warn("Renderer lama terdeteksi, membersihkan...");
        endARSession(); 
    }

    const container = elements.arContainer;
    const rect = container.getBoundingClientRect();

    arRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    arRenderer.setSize(rect.width, rect.height);
    arRenderer.xr.enabled = true;
    container.appendChild(arRenderer.domElement);
    
    arScene = new THREE.Scene();
    arCamera = new THREE.PerspectiveCamera(70, rect.width / rect.height, 0.01, 20);
    arScene.add(arCamera); 

    arScene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(0, 10, 5);
    arScene.add(dirLight);

    const ringGeo = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });    
    arReticle = new THREE.Mesh(ringGeo, ringMat);
    arReticle.visible = false;
    arReticle.matrixAutoUpdate = false;
    arScene.add(arReticle);

    loadArrows();
}

function loadArrows() {
    hudArrowObject = null;
    groundArrowObject = null;

    gltfLoader.load(AR_HUD_ARROW_URL, (gltf) => {
        if (!arCamera) return; 
        const existingArrow = arCamera.getObjectByName('HUD_ARROW');
        if (existingArrow) arCamera.remove(existingArrow);

        hudArrowObject = gltf.scene.clone();
        hudArrowObject.name = 'HUD_ARROW'; 
        
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
        
        arCamera.add(hudArrowObject); 
    });

    gltfLoader.load(AR_TURN_ARROW_URL, (gltf) => {
        if (!arScene) return; 
        const existingTurn = arScene.getObjectByName('GROUND_ARROW');
        if (existingTurn) arScene.remove(existingTurn);

        groundArrowObject = gltf.scene.clone();
        groundArrowObject.name = 'GROUND_ARROW'; 
        groundArrowObject.scale.set(0.8, 0.8, 0.8); 
        groundArrowObject.visible = false;
        
        arScene.add(groundArrowObject);
    });
}

export async function startARSession() {
    if (arSession) return; 
    if (!navigator.xr) { alert("WebXR tidak didukung."); return; }

    state.isArActive = true; 

    elements.arContainer.style.display = 'block';
    elements.bottomNavbar.classList.add('translate-y-full'); 
    elements.arButton.style.display = 'none';
    elements.closeArButton.style.display = 'block';
    document.getElementById('ar-map-overlay').style.display = 'block';
    if (arScanningText) arScanningText.style.display = 'none'; 

    if (state.arMiniMap) {
        state.arMiniMap.remove(); 
        state.arMiniMap = null;   
        arMiniUserMarker = null;  
    }

    initMiniMap();
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
    if (arSession) { 
        arSession.removeEventListener("end", endARSession);
        arSession.end().catch((e) => console.log("Session end error:", e));
        arSession = null; 
    }
    
    if (arRenderer) {
        arRenderer.setAnimationLoop(null);
        if (arRenderer.domElement && arRenderer.domElement.parentNode) {
            arRenderer.domElement.parentNode.removeChild(arRenderer.domElement);
        }
        arRenderer.dispose(); 
        arRenderer = null;    
    }

    arScene = null;
    arCamera = null;
    arReticle = null;
    arHitTestSource = null;
    arLocalSpace = null;

    hudArrowObject = null;
    groundArrowObject = null;

    state.isArActive = false; 

    elements.arContainer.style.display = 'none';
    elements.arButton.style.display = 'flex';
    elements.closeArButton.style.display = 'none';
    
    if (!state.isNavigating && elements.bottomNavbar) {
        elements.bottomNavbar.classList.remove('translate-y-full');
    }
    
    // Hide UI Elements
    if (arScanningText) arScanningText.style.display = 'none';
    if (arWrongWay) arWrongWay.style.display = 'none';
    if (arDangerScreen) arDangerScreen.style.display = 'none';
    if (arTurnIndicator) arTurnIndicator.classList.add('hidden'); // Sembunyikan Nav Bar
    
    isGroundArrowPlaced = false; 
    isTurnActive = false;
    
    console.log("AR Session Cleaned Successfully.");
}

function onARFrame(time, frame) {
    const session = frame.session;
    if (!session) return;

    if (state.arMiniMap && state.userLocation) {
        state.arMiniMap.setCenter(state.userLocation);
        state.arMiniMap.setBearing(state.smoothedAlpha || 0);
        if (arMiniUserMarker) arMiniUserMarker.setLngLat(state.userLocation);
    }

    checkNavigationStatus();
    updateHUDArrow();
    updateGroundArrow(frame);

    if(arRenderer && arScene && arCamera) {
        arRenderer.render(arScene, arCamera);
    }
}

// GANTI FUNGSI INI DI ar-navigation.js

function checkNavigationStatus() {
    if (!state.currentRouteLine || !state.userLocation) return;

    const userPt = turf.point(state.userLocation);
    const line = state.currentRouteLine;
    const snapped = turf.nearestPointOnLine(line, userPt);
    const currentIdx = snapped.properties.index;
    const coords = line.coordinates;

    let turnFound = false;

    // PERUBAHAN 1: Loop sampai akhir rute (atau batas tertentu yang jauh)
    // Sebelumnya hanya scanning 4 titik (Math.min(currentIdx + 4)), itu terlalu pendek.
    // Kita scan sampai akhir untuk menemukan "Next Turn" dimanapun berada.
    for (let i = currentIdx; i < coords.length - 2; i++) {
        const p1 = coords[i];
        const p2 = coords[i+1];
        const p3 = coords[i+2];

        // Hitung sudut
        const bearing1 = turf.bearing(turf.point(p1), turf.point(p2));
        const bearing2 = turf.bearing(turf.point(p2), turf.point(p3));
        
        let angleDiff = Math.abs(bearing1 - bearing2);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        // Jika ditemukan belokan tajam (> 30 derajat)
        if (angleDiff > TURN_ANGLE_THRESHOLD) {
            turnFound = true;
            
            // Hitung jarak Real-time dari User ke Titik Belokan (p2)
            const distToTurn = turf.distance(userPt, turf.point(p2), { units: 'kilometers' }) * 1000;

            // --- BAGIAN UI (SELALU MUNCUL) ---
            // Tentukan Kiri/Kanan
            let turnDirectionSigned = (bearing2 - bearing1 + 540) % 360 - 180;
            let isRightTurn = turnDirectionSigned > 0;
            
            // PERUBAHAN 2: Update UI Bar TANPA mengecek threshold jarak
            // UI akan menampilkan "150m - Belok Kanan" misalnya.
            updateTurnUI(true, distToTurn, isRightTurn);


            // --- BAGIAN PANAH 3D (TETAP PAKAI THRESHOLD) ---
            // Kita hanya spawn panah 3D di lantai jika sudah DEKAT (< 25m)
            // Supaya user tidak melihat panah melayang jauh di angkasa/tembok
            if (distToTurn < TURN_DISTANCE_THRESHOLD) {
                if (!isTurnActive) {
                    isTurnActive = true;
                    isGroundArrowPlaced = false; 
                    turnBearing = (bearing2 + 360) % 360; 
                }
            } else {
                // Jika belokan masih jauh (> 25m), matikan mode 3D arrow 
                // tapi UI tetap nyala (karena turnFound = true)
                if (isTurnActive) {
                    isTurnActive = false;
                    isGroundArrowPlaced = false;
                    if (groundArrowObject) groundArrowObject.visible = false;
                    if (arReticle) arReticle.visible = false;
                }
            }

            // Kita sudah nemu belokan terdekat, stop scanning.
            return; 
        }
    }

    // Jika sampai akhir rute TIDAK ada belokan lagi (Jalan Lurus sampai finish)
    if (!turnFound) {
        // Opsional: Bisa sembunyikan UI atau tampilkan jarak ke Finish
        // Di sini kita sembunyikan saja agar bersih
        updateTurnUI(false); 

        // Matikan panah 3D
        if (isTurnActive) {
            isTurnActive = false;
            isGroundArrowPlaced = false; 
            if (groundArrowObject) groundArrowObject.visible = false;
            if (arReticle) arReticle.visible = false;
        }
    }
}

// --- FUNGSI UPDATE UI BAR ---
function updateTurnUI(isVisible, distanceMeters = 0, isRightTurn = false) {
    if (!arTurnIndicator) return;

    if (!isVisible) {
        arTurnIndicator.style.display = 'none'; // Gunakan style display langsung agar lebih kuat
        arTurnIndicator.classList.add('hidden');
        return;
    }

    // Tampilkan UI
    arTurnIndicator.style.display = 'flex';
    arTurnIndicator.classList.remove('hidden');

    // Update Text
    if (arTurnDistance) arTurnDistance.innerText = `${Math.round(distanceMeters)} m`;
    
    // Update Arah & Ikon
    if (isRightTurn) {
        if (arTurnInstruction) arTurnInstruction.innerText = "Belok Kanan";
        // Flip ikon secara horizontal untuk belok kanan
        if (arTurnIcon) arTurnIcon.style.transform = "scaleX(-1)"; 
    } else {
        if (arTurnInstruction) arTurnInstruction.innerText = "Belok Kiri";
        // Reset flip untuk belok kiri (gambar default)
        if (arTurnIcon) arTurnIcon.style.transform = "scaleX(1)"; 
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