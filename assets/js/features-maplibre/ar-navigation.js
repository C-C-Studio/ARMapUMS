import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { state, elements, config } from './state.js';

// --- KONFIGURASI ---
const AR_NAV_ARROW_URL = 'https://raw.githubusercontent.com/C-C-Studio/ARMapUMS/main/assets/3DModel/arrow2.glb';
const AR_DEBUG = true;

const ARROW_ROTATION_OFFSET = -65;

// Jarak (meter) untuk memicu panah pindah ke depan
const NAV_ARROW_PROXIMITY = 1.5;

const SPAWN_INTERVAL = 2.0; // Meter (Arrow pindah setiap user jalan 2m)

let lastSpawnDistance = 0; // Menyimpan jarak tempuh (meter) saat terakhir arrow pindah
let pendingArrowUpdate = false; // Flag minta update posisi

let lastDistanceCheckTime = 0; // Untuk membatasi frekuensi hitungan Turf.js

// Variabel Three.js & WebXR
let arSession = null;
let arRenderer, arScene, arCamera, arReticle;
let arHitTestSource = null;
let arLocalSpace = null;
let gltfLoader = new GLTFLoader();
let navArrowObject = null;
let isSpawningArrow = false;

// State Logic AR
let initialScanComplete = false; 
let arSurfaceDetected = false;
const HORIZONTAL_ANGLE_THRESHOLD = 5; 

// Referensi UI Tambahan
const arScanningText = document.getElementById('ar-scanning-text');
const arWrongWay = document.getElementById('ar-wrong-way');

// Variabel Marker Mini Map (BARU)
let arMiniUserMarker = null;

// --- MINI MAP (MapLibre) ---
function initMiniMap() {
    if (state.arMiniMap) return;
    
    const container = document.getElementById('ar-map-inner');
    if(!container) return;

    state.arMiniMap = new maplibregl.Map({
        container: 'ar-map-inner',
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`,
        center: state.userLocation || [config.lonmap, config.latmap],
        zoom: 18,
        pitch: 0,
        interactive: false,
        attributionControl: false
    });

    state.arMiniMap.on('load', () => {
        if (state.currentRouteLine) {
            updateMiniMapRoute(state.currentRouteLine);
        }
        
        // --- PERBAIKAN MARKER ARAH ---
        // Buat elemen marker dengan struktur Kerucut + Titik
        const markerEl = document.createElement('div');
        markerEl.className = 'user-location-marker'; // Class CSS global yang sudah ada
        markerEl.innerHTML = `
            <div class="user-location-heading" style="transform: translate(-50%, -50%) rotate(0deg);"></div>
            <div class="user-location-dot"></div>
        `;

        // Simpan ke variabel global modul ini agar bisa diupdate posisinya
        arMiniUserMarker = new maplibregl.Marker({ 
            element: markerEl,
            anchor: 'center',             // Pastikan titik tengah di koordinat
            rotationAlignment: 'viewport' // PENTING: Marker selalu menghadap atas layar
        })
        .setLngLat(state.userLocation || [0,0])
        .addTo(state.arMiniMap);
    });
}

// Fungsi Helper: Hitung jarak (meter) dari awal rute sampai posisi user saat ini
function getDistanceTraveled() {
    if (!state.currentRouteLine || !state.userLocation) return 0;

    const line = state.currentRouteLine;
    const userPt = turf.point(state.userLocation);

    // 1. Cari titik snap di garis rute
    const snapped = turf.nearestPointOnLine(line, userPt);
    
    // 2. Buat garis potongan dari Awal -> Titik Snap User
    const startPt = turf.point(line.coordinates[0]);
    const sliced = turf.lineSlice(startPt, snapped, line);
    
    // 3. Hitung panjang potongan tersebut (dalam kilometer -> ubah ke meter)
    const distance = turf.length(sliced, { units: 'kilometers' }) * 1000;
    
    return distance;
}

function updateMiniMapRoute(geoJSON) {
    if (!state.arMiniMap || !state.arMiniMap.loaded()) return;
    
    if (state.arMiniMap.getSource('ar-route')) {
        state.arMiniMap.getSource('ar-route').setData(geoJSON);
    } else {
        state.arMiniMap.addSource('ar-route', {
            type: 'geojson',
            data: geoJSON
        });
        state.arMiniMap.addLayer({
            id: 'ar-route-line',
            type: 'line',
            source: 'ar-route',
            paint: { 'line-color': '#3b82f6', 'line-width': 5 }
        });
    }
}

// --- THREE.JS & WEBXR SETUP ---

function initARRenderer() {
    if (arRenderer) return;
    
    const container = elements.arContainer;
    const rect = container.getBoundingClientRect();

    arRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    arRenderer.setSize(rect.width, rect.height);
    arRenderer.xr.enabled = true;
    
    arScene = new THREE.Scene();
    arCamera = new THREE.PerspectiveCamera(70, rect.width / rect.height, 0.01, 20);
    
    arScene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(0, 10, 5);
    arScene.add(dirLight);

    const ringGeo = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);
    const ringMatValid = new THREE.MeshBasicMaterial({ color: 0x00ff00 });   
    const ringMatInvalid = new THREE.MeshBasicMaterial({ color: 0xff0000 }); 
    
    arReticle = new THREE.Mesh(ringGeo, ringMatInvalid);
    arReticle.visible = false;
    arReticle.matrixAutoUpdate = false;
    arReticle.userData = { matValid: ringMatValid, matInvalid: ringMatInvalid };
    
    arScene.add(arReticle);
    container.appendChild(arRenderer.domElement);
}

export async function startARSession() {
    if (arSession) {
        console.warn("Sesi AR sudah aktif.");
        return;
    }
    
    if (!navigator.xr) {
        alert("WebXR tidak ditemukan. Pastikan Anda menggunakan Chrome di Android & HTTPS.");
        return;
    }

    const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!isSupported) {
        alert("Mode AR tidak didukung perangkat ini.");
        return;
    }

    initialScanComplete = false;
    arSurfaceDetected = false;

    elements.arContainer.style.display = 'block';
    elements.bottomNavbar.classList.add('translate-y-full'); 
    elements.arButton.style.display = 'none';
    elements.closeArButton.style.display = 'block';
    document.getElementById('ar-map-overlay').style.display = 'block';
    if (arScanningText) arScanningText.style.display = 'flex'; 

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
        console.error("Gagal Start AR:", e);
        if (!e.message.includes("already an active")) {
            alert("Gagal memulai sesi AR: " + e.message);
        }
        endARSession();
    }
}

export function endARSession() {
    if (arSession) {
        arSession.end();
        arSession = null;
    }
    
    elements.arContainer.style.display = 'none';
    elements.arButton.style.display = 'flex';
    elements.closeArButton.style.display = 'none';
    if (arScanningText) arScanningText.style.display = 'none';
    if (arWrongWay) arWrongWay.style.display = 'none';
    
    if (!state.isNavigating) {
        elements.bottomNavbar.classList.remove('translate-y-full');
    }

    if (navArrowObject) {
        arScene.remove(navArrowObject);
        navArrowObject = null;
    }
    
    arRenderer.setAnimationLoop(null);
}

// --- FRAME LOOP AR ---
function onARFrame(time, frame) {
    const session = frame.session;
    if (!session) return;

    // 1. Update Mini Map (Tetap sama)
    if (state.arMiniMap && state.userLocation) {
        state.arMiniMap.setCenter(state.userLocation);
        state.arMiniMap.setBearing(state.smoothedAlpha || 0); 
        if (arMiniUserMarker) {
            arMiniUserMarker.setLngLat(state.userLocation);
        }
    }

    // 2. Deteksi Lantai & Logika Spawn
    if (arHitTestSource && arLocalSpace) {
        const hitTestResults = frame.getHitTestResults(arHitTestSource);
        
        if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(arLocalSpace);
            
            // Cek kemiringan lantai
            const rot = new THREE.Matrix4().extractRotation(new THREE.Matrix4().fromArray(pose.transform.matrix));
            const normal = new THREE.Vector3(0, 1, 0).applyMatrix4(rot);
            const angle = normal.angleTo(new THREE.Vector3(0, 1, 0)) * (180/Math.PI);
            const isFlat = angle < HORIZONTAL_ANGLE_THRESHOLD;

            arReticle.visible = true;
            arReticle.matrix.fromArray(pose.transform.matrix);
            arReticle.material = isFlat ? arReticle.userData.matValid : arReticle.userData.matInvalid;

            if (isFlat) {
                initialScanComplete = true;
                if (arScanningText) arScanningText.style.display = 'none';
                
                // A. Spawn PERTAMA KALI
                if (state.isNavigating && !navArrowObject && !isSpawningArrow) {
                    spawnNavArrow(pose);
                    // Set jarak awal agar tidak langsung loncat
                    lastSpawnDistance = getDistanceTraveled(); 
                }

                // B. Logika Update Posisi Arrow (TURF.JS BASED)
                if (navArrowObject && state.isNavigating) {
                    
                    // --- PERBAIKAN ANTI-FREEZE ---
                    // Hanya hitung jarak setiap 1000ms (1 detik) sekali, jangan setiap frame!
                    const now = performance.now();
                    
                    if (now - lastDistanceCheckTime > 1000) {
                        lastDistanceCheckTime = now; // Reset timer
                        
                        // 1. Hitung jarak tempuh user saat ini (BERAT, lakukan jarang-jarang)
                        const currentDist = getDistanceTraveled();

                        // 2. Cek apakah sudah berjalan sejauh SPAWN_INTERVAL
                        if (currentDist - lastSpawnDistance >= SPAWN_INTERVAL) {
                            pendingArrowUpdate = true;
                        }
                        
                        // Debugging ringan (opsional)
                        // console.log(`Distance Checked: ${currentDist.toFixed(1)}m`);
                    }

                    // 3. Eksekusi Pindah Posisi (Hanya jika Reticle terlihat/Lantai Valid)
                    if (pendingArrowUpdate && isFlat) {
                        console.log(`Jalan ${SPAWN_INTERVAL}m terdeteksi. Memindah arrow...`);
                        
                        // --- SETTING POSISI BARU ---
                        const FIXED_DISTANCE = 3.0; // Jarak spawn di depan

                        const camPos = new THREE.Vector3();
                        const camQuat = new THREE.Quaternion();
                        arCamera.getWorldPosition(camPos);
                        arCamera.getWorldQuaternion(camQuat);

                        const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
                        forwardDir.y = 0; 
                        forwardDir.normalize();

                        const targetPos = camPos.clone().add(forwardDir.multiplyScalar(FIXED_DISTANCE));
                        
                        // Kunci ke lantai
                        const reticlePos = new THREE.Vector3().setFromMatrixPosition(arReticle.matrix);
                        targetPos.y = reticlePos.y; 

                        navArrowObject.position.copy(targetPos);
                        
                        // Reset hitungan
                        // Kita panggil getDistanceTraveled() sekali lagi di sini untuk akurasi update terakhir
                        lastSpawnDistance = getDistanceTraveled(); 
                        pendingArrowUpdate = false;
                    }
                }
            }

        } else {
            arReticle.visible = false;
            if (!initialScanComplete && arScanningText) {
                arScanningText.style.display = 'flex';
            }
        }
    }
    
    // 3. Update Rotasi Panah (Selalu update rotasi walau posisi diam)
    if (navArrowObject) {
        updateArrowRotationOnly(); 
    }

    arRenderer.render(arScene, arCamera);
}

// --- LOGIKA NAVIGASI AR ---
function getBearingToNextPoint() {
    if (!state.currentRouteLine || !state.userLocation) return null;
    
    const userPt = turf.point(state.userLocation);
    const line = state.currentRouteLine;
    
    const snapped = turf.nearestPointOnLine(line, userPt);
    const index = snapped.properties.index;
    const coords = line.coordinates;
    
    let targetIndex = index + 2; 
    if (targetIndex >= coords.length) targetIndex = coords.length - 1;
    
    const targetPt = coords[targetIndex];
    const bearing = turf.bearing(userPt, turf.point(targetPt));
    return (bearing + 360) % 360; 
}

async function spawnNavArrow(pose) {
    isSpawningArrow = true;
    try {
        const gltf = await new Promise((resolve, reject) => {
            gltfLoader.load(AR_NAV_ARROW_URL, resolve, undefined, reject);
        });
        
        const arrow = gltf.scene;
        navArrowObject = arrow;
        
        const mat = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const position = new THREE.Vector3().setFromMatrixPosition(mat);
        arrow.position.copy(position); 
        
        arScene.add(arrow);
    } catch (e) {
        console.error("Gagal load arrow:", e);
    } finally {
        isSpawningArrow = false;
    }
}

// Ganti nama agar jelas bahwa ini HANYA rotasi
function updateArrowRotationOnly() {
    if (!navArrowObject) return;

    const targetBearing = getBearingToNextPoint();
    const currentHeading = state.smoothedAlpha || 0;

    if (targetBearing === null) return;

    let angleDiff = targetBearing - currentHeading;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;

    // Logic Salah Arah (Tetap)
    if (Math.abs(angleDiff) > 100) {
        if (arWrongWay) arWrongWay.style.display = 'flex';
        navArrowObject.visible = false; 
    } else {
        if (arWrongWay) arWrongWay.style.display = 'none';
        navArrowObject.visible = true;
    }
    
    // Ambil Orientasi Kamera (Hanya untuk rotasi)
    const camQuat = new THREE.Quaternion();
    arCamera.getWorldQuaternion(camQuat);
    const camEuler = new THREE.Euler().setFromQuaternion(camQuat, 'YXZ');
    
    // --- BAGIAN POSISI DIHAPUS DI SINI ---
    // (Kode lerp / forwardDir dihapus agar panah diam di tempat)
    
    // Terapkan Rotasi
    navArrowObject.rotation.y = camEuler.y + THREE.MathUtils.degToRad(-angleDiff + ARROW_ROTATION_OFFSET);
}