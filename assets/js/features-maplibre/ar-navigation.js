import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { state, elements, config } from './state.js';

// --- KONFIGURASI ---
const AR_NAV_ARROW_URL = 'assets/3DModel/arrow.glb';
const AR_DEBUG = true;

// Offset Rotasi Model (Sesuaikan jika model miring)
const ARROW_ROTATION_OFFSET =-15; 

// Konfigurasi Navigasi
const TURN_DISTANCE_THRESHOLD = 15; // Meter (Jarak sebelum belokan untuk spawn ground arrow)
const TURN_ANGLE_THRESHOLD = 30;    // Derajat (Sudut minimal dianggap belokan)
const HUD_ARROW_DISTANCE = 0.5;     // Meter (Jarak HUD arrow dari mata pengguna)


// Variabel Global
let arSession = null;
let arRenderer, arScene, arCamera, arReticle;
let arHitTestSource = null;
let arLocalSpace = null;
let gltfLoader = new GLTFLoader();

// --- OBJEK AR ---
let hudArrowObject = null;   // Panah Kompas (Melayang)
let groundArrowObject = null; // Panah Belokan (Nempel Tanah)

// State Logic
let isTurnActive = false;     // Apakah sedang dekat belokan?
let turnBearing = 0;          // Arah belokan selanjutnya
let initialScanComplete = false; 

// UI
const arScanningText = document.getElementById('ar-scanning-text');
const arWrongWay = document.getElementById('ar-wrong-way');
const arDangerScreen = document.getElementById('ar-danger-screen'); // <--- TAMBAHAN
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
        zoom: 18,
        pitch: 0,
        interactive: false,
        attributionControl: false
    });

    state.arMiniMap.on('load', () => {
        if (state.currentRouteLine) {
            updateMiniMapRoute(state.currentRouteLine);
        }
        // Marker User (Kerucut Arah)
        const markerEl = document.createElement('div');
        markerEl.className = 'user-location-marker'; 
        markerEl.innerHTML = `
            <div class="user-location-heading" style="transform: translate(-50%, -50%) rotate(0deg);"></div>
            <div class="user-location-dot"></div>
        `;
        arMiniUserMarker = new maplibregl.Marker({ 
            element: markerEl,
            anchor: 'center',             
            rotationAlignment: 'viewport' 
        })
        .setLngLat(state.userLocation || [0,0])
        .addTo(state.arMiniMap);
    });
}

function updateMiniMapRoute(geoJSON) {
    if (!state.arMiniMap || !state.arMiniMap.loaded()) return;
    if (state.arMiniMap.getSource('ar-route')) {
        state.arMiniMap.getSource('ar-route').setData(geoJSON);
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
    if (arRenderer) return;
    const container = elements.arContainer;
    const rect = container.getBoundingClientRect();

    arRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    arRenderer.setSize(rect.width, rect.height);
    arRenderer.xr.enabled = true;
    
    arScene = new THREE.Scene();
    arCamera = new THREE.PerspectiveCamera(70, rect.width / rect.height, 0.01, 20);
    
    // --- PERBAIKAN 1: Masukkan Kamera ke Scene ---
    // Ini WAJIB agar objek yang ditempel (add) ke kamera bisa ikut dirender
    arScene.add(arCamera); 
    // ---------------------------------------------
    
    arScene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(0, 10, 5);
    arScene.add(dirLight);

    // ... (sisa kode reticle dll) ...

    // Reticle (Hanya muncul saat belokan)
    const ringGeo = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00 }); // Kuning untuk Turn   
    arReticle = new THREE.Mesh(ringGeo, ringMat);
    arReticle.visible = false;
    arReticle.matrixAutoUpdate = false;
    arScene.add(arReticle);
    
    container.appendChild(arRenderer.domElement);

    // Load Model Panah (Untuk HUD & Ground)
    loadArrows();
}

function loadArrows() {
    gltfLoader.load(AR_NAV_ARROW_URL, (gltf) => {
        // 1. Setup HUD Arrow (Kompas)
        hudArrowObject = gltf.scene.clone();
        
        hudArrowObject.traverse((child) => {
            if (child.isMesh) {
                // --- PERBAIKAN 3: Setup Material Merah & Asli ---
                
                // A. Simpan Material Asli (Agar bisa dikembalikan nanti)
                child.userData.originalMaterial = child.material;

                // B. Buat Material Merah (Khusus saat salah arah)
                child.userData.redMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff0000, // Merah Terang
                    depthTest: false, // Tetap HUD (Overlay)
                    depthWrite: false
                });

                // C. Setting Default (HUD Mode)
                child.material.depthTest = false; 
                child.material.depthWrite = false;
                child.renderOrder = 999; 
            }
        });

        hudArrowObject.scale.set(0.08, 0.08, 0.08); 
        
        // Tempel ke Kamera
        arCamera.add(hudArrowObject); 
        
        // Posisi LOKAL (Relatif layar)
        hudArrowObject.position.set(0, -0.15, -0.8); 
        
        // Flag untuk melacak status warna saat ini (agar tidak ganti warna tiap frame)
        hudArrowObject.userData.isRed = false;

        hudArrowObject.visible = false; 

        // 2. Setup Ground Arrow (Tetap normal)
        groundArrowObject = gltf.scene.clone();
        groundArrowObject.scale.set(0.8, 0.8, 0.8); 
        groundArrowObject.visible = false;
        arScene.add(groundArrowObject);
    });
}

export async function startARSession() {
    if (arSession) return;
    if (!navigator.xr) { alert("WebXR tidak didukung."); return; }

    elements.arContainer.style.display = 'block';
    elements.bottomNavbar.classList.add('translate-y-full'); 
    elements.arButton.style.display = 'none';
    elements.closeArButton.style.display = 'block';
    document.getElementById('ar-map-overlay').style.display = 'block';
    
    // Sembunyikan teks scan dulu, karena hanya dipakai saat belokan
    if (arScanningText) arScanningText.style.display = 'none'; 

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
        console.error(e);
        endARSession();
    }
}

export function endARSession() {
    if (arSession) { arSession.end(); arSession = null; }
    
    elements.arContainer.style.display = 'none';
    elements.arButton.style.display = 'flex';
    elements.closeArButton.style.display = 'none';
    if (!state.isNavigating) elements.bottomNavbar.classList.remove('translate-y-full');
    
    arRenderer.setAnimationLoop(null);
}

// --- LOGIKA LOOP UTAMA ---
function onARFrame(time, frame) {
    const session = frame.session;
    if (!session) return;

    // A. Update Mini Map
    if (state.arMiniMap && state.userLocation) {
        state.arMiniMap.setCenter(state.userLocation);
        state.arMiniMap.setBearing(state.smoothedAlpha || 0);
        if (arMiniUserMarker) arMiniUserMarker.setLngLat(state.userLocation);
    }

    // B. Logika Navigasi Cerdas (Check Turn)
    checkNavigationStatus();

    // C. Update HUD Arrow (Kompas Melayang)
    updateHUDArrow();

    // D. Update Ground Arrow (Hanya jika Belokan)
    updateGroundArrow(frame);

    arRenderer.render(arScene, arCamera);
}

// --- 1. LOGIKA TURF.JS: Deteksi Belokan ---
function checkNavigationStatus() {
    if (!state.currentRouteLine || !state.userLocation) return;

    const userPt = turf.point(state.userLocation);
    const line = state.currentRouteLine;

    // Cari posisi user di garis
    const snapped = turf.nearestPointOnLine(line, userPt);
    const currentIdx = snapped.properties.index;
    const coords = line.coordinates;

    isTurnActive = false; // Reset status

    // Scan 2-3 titik ke depan untuk cari sudut tajam
    for (let i = currentIdx; i < Math.min(currentIdx + 3, coords.length - 2); i++) {
        const p1 = coords[i];
        const p2 = coords[i+1]; // Titik sudut
        const p3 = coords[i+2];

        // Hitung Sudut
        const bearing1 = turf.bearing(turf.point(p1), turf.point(p2));
        const bearing2 = turf.bearing(turf.point(p2), turf.point(p3));
        let angleDiff = Math.abs(bearing1 - bearing2);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        // Jika Sudut Tajam (> 30 derajat)
        if (angleDiff > TURN_ANGLE_THRESHOLD) {
            // Hitung jarak ke belokan tersebut
            const distToTurn = turf.distance(userPt, turf.point(p2), { units: 'kilometers' }) * 1000;

            // Jika dekat (< 15 meter)
            if (distToTurn < TURN_DISTANCE_THRESHOLD) {
                isTurnActive = true;
                
                // Simpan arah tujuan SETELAH belok untuk panah ground
                // Agar panah ground menunjuk ke jalan yang harus diambil
                turnBearing = (bearing2 + 360) % 360; 
                
                // Debugging
                if (AR_DEBUG) console.log(`BELOKAN TERDETEKSI: ${distToTurn.toFixed(1)}m, Arah: ${turnBearing.toFixed(0)}`);
                return; // Selesai, prioritas belokan
            }
        }
    }
}

// --- 2. HUD ARROW (Kompas Melayang + Salah Arah + Warna Merah + Efek Layar) ---
function updateHUDArrow() {
    if (!hudArrowObject) return;

    hudArrowObject.visible = true;

    // --- 1. POSISI (TETAP SAMA) ---
    // Posisi fix relatif terhadap layar sudah diset di loadArrows.
    
    // --- 2. ROTASI & LOGIKA ---
    const targetBearing = getGeneralDirection();
    const currentHeading = state.smoothedAlpha || 0;

    if (targetBearing !== null) {
        let angleDiff = targetBearing - currentHeading;
        
        // Normalisasi sudut (-180 sampai 180)
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;

        // =============================================
        // 🔥 LOGIKA SALAH ARAH (UI + WARNA + SCREEN EFFECT)
        // =============================================
        const WRONG_WAY_THRESHOLD = 100; // Toleransi salah arah

        if (Math.abs(angleDiff) > WRONG_WAY_THRESHOLD) {
            
            // A. Tampilkan Teks Warning
            if (arWrongWay && arWrongWay.style.display !== 'flex') {
                arWrongWay.style.display = 'flex';
            }

            // B. Tampilkan EFEK LAYAR MERAH (Danger Screen)
            if (arDangerScreen && arDangerScreen.style.display !== 'block') {
                arDangerScreen.style.display = 'block';
            }

            // C. Ganti Warna Panah jadi MERAH
            if (!hudArrowObject.userData.isRed) {
                hudArrowObject.traverse((child) => {
                    if (child.isMesh && child.userData.redMaterial) {
                        child.material = child.userData.redMaterial;
                    }
                });
                hudArrowObject.userData.isRed = true;
            }

        } else {
            
            // A. Sembunyikan Teks Warning
            if (arWrongWay && arWrongWay.style.display !== 'none') {
                arWrongWay.style.display = 'none';
            }

            // B. Sembunyikan EFEK LAYAR MERAH
            if (arDangerScreen && arDangerScreen.style.display !== 'none') {
                arDangerScreen.style.display = 'none';
            }

            // C. Kembalikan Warna Panah ASLI
            if (hudArrowObject.userData.isRed) {
                hudArrowObject.traverse((child) => {
                    if (child.isMesh && child.userData.originalMaterial) {
                        child.material = child.userData.originalMaterial;
                    }
                });
                hudArrowObject.userData.isRed = false;
            }
        }
        // =============================================

        // --- LOGIKA QUATERNION (DYNAMIC TILT) ---
        const targetQuaternion = new THREE.Quaternion();
        const baseRotation = new THREE.Euler(0, 0, 0, 'YXZ');
        
        // Dynamic Tilt
        const defaultTilt = 40; 
        let tiltFactor = Math.cos(THREE.MathUtils.degToRad(angleDiff / 2));
        let dynamicTilt = defaultTilt * Math.abs(tiltFactor);
        if (dynamicTilt < 10) dynamicTilt = 10; 

        baseRotation.x = THREE.MathUtils.degToRad(dynamicTilt); 
        baseRotation.y = THREE.MathUtils.degToRad(-angleDiff + ARROW_ROTATION_OFFSET);

        targetQuaternion.setFromEuler(baseRotation);
        hudArrowObject.quaternion.slerp(targetQuaternion, 0.15);
    }
}

// --- 3. GROUND ARROW (Hanya Saat Belok) ---
function updateGroundArrow(frame) {
    if (!groundArrowObject || !arHitTestSource) return;

    // Jika TIDAK ada belokan dekat -> Sembunyikan Ground Arrow
    if (!isTurnActive) {
        groundArrowObject.visible = false;
        arReticle.visible = false;
        if (arScanningText) arScanningText.style.display = 'none';
        return;
    }

    // Jika ADA belokan -> Lakukan Hit Test untuk spawn panah di lantai
    const hitTestResults = frame.getHitTestResults(arHitTestSource);
    if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(arLocalSpace);

        // Cek lantai datar
        const rot = new THREE.Matrix4().extractRotation(new THREE.Matrix4().fromArray(pose.transform.matrix));
        const normal = new THREE.Vector3(0, 1, 0).applyMatrix4(rot);
        const angle = normal.angleTo(new THREE.Vector3(0, 1, 0)) * (180/Math.PI);

        if (angle < 10) { // Lantai datar valid
            // Posisikan Reticle
            arReticle.visible = true;
            arReticle.matrix.fromArray(pose.transform.matrix);

            // Posisikan Ground Arrow (Ikuti Reticle)
            groundArrowObject.visible = true;
            const newPos = new THREE.Vector3().setFromMatrixPosition(arReticle.matrix);
            groundArrowObject.position.copy(newPos);

            // Rotasi Ground Arrow: Menunjuk ke JALAN SETELAH BELOKAN (turnBearing)
            const currentHeading = state.smoothedAlpha || 0;
            let turnDiff = turnBearing - currentHeading;
            if (turnDiff > 180) turnDiff -= 360;
            if (turnDiff < -180) turnDiff += 360;

            const camQuat = new THREE.Quaternion();
            arCamera.getWorldQuaternion(camQuat);
            const camEuler = new THREE.Euler().setFromQuaternion(camQuat, 'YXZ');

            // Putar panah di lantai
            groundArrowObject.rotation.set(0, camEuler.y + THREE.MathUtils.degToRad(-turnDiff + ARROW_ROTATION_OFFSET), 0);

            if (arScanningText) arScanningText.style.display = 'none';
        }
    } else {
        // Kalau sedang cari belokan tapi lantai belum ketemu
        arReticle.visible = false;
        if (arScanningText) {
            arScanningText.style.display = 'flex';
            arScanningText.innerText = "⚠️ Belokan Dekat! Arahkan HP ke lantai...";
        }
    }
}

// Helper: Ambil arah umum jalan (untuk HUD)
function getGeneralDirection() {
    if (!state.currentRouteLine || !state.userLocation) return null;
    const userPt = turf.point(state.userLocation);
    const line = state.currentRouteLine;
    const snapped = turf.nearestPointOnLine(line, userPt);
    const coords = line.coordinates;
    let targetIdx = snapped.properties.index + 3; // Lihat agak jauh ke depan
    if (targetIdx >= coords.length) targetIdx = coords.length - 1;
    
    return (turf.bearing(userPt, turf.point(coords[targetIdx])) + 360) % 360;
}