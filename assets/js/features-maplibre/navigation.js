import { state, config, elements } from './state.js';

let mapInstance = null;
let geolocateControl = null;

export function setupNavigation(map, geolocateCtrl) {
    mapInstance = map;
    geolocateControl = geolocateCtrl;

    elements.startNavBtn.addEventListener('click', startNavigationMode);
    elements.cancelNavBtn.addEventListener('click', cancelNavigationMode);
    elements.snapToRoadBtn.addEventListener('click', toggleSnapToRoad);

    // Listener Interupsi (Snap Back)
    map.on('dragstart', interruptNavigation);
    map.on('zoomstart', interruptNavigation);
    map.on('dragend', startSnapBackTimer);
    map.on('zoomend', startSnapBackTimer);
}

export async function createRoute(map, destLat, destLon, destName) {
    mapInstance = map; // Pastikan instance terupdate
    
    clearTimeout(state.snapBackTimer); 
    state.snapBackTimer = null;
    state.isNavigating = false;     
    state.wasNavigating = false;  
    state.isPreviewingRoute = true;

    if (!state.isUserOnCampusFlag) {
        alert("Fitur rute hanya dapat digunakan saat Anda berada di area kampus UMS.");
        return;
    }
    if (!state.userLocation) {
        alert("Lokasi Anda belum ditemukan. Silakan aktifkan lokasi Anda.");
        return;
    }

    const startLng = state.userLocation[0];
    const startLat = state.userLocation[1];

    // Hapus layer rute lama jika ada
    if (map.getLayer('route')) map.removeLayer('route');
    if (map.getSource('route')) map.removeSource('route');
    
    // Sembunyikan Kompas & Indikator Derajat
    if (elements.compassIndicator) elements.compassIndicator.style.display = 'none';
    if (elements.degreeIndicator) elements.degreeIndicator.style.display = 'none';

    // Sembunyikan Tombol Locate & AR
    if (elements.locateButton) elements.locateButton.style.display = 'none';
    if (elements.arButton) elements.arButton.style.display = 'none';

    elements.startNavBtn.style.display = 'flex';
    // elements.startNavBtn.style.display = 'none';
    elements.cancelNavBtn.style.display = 'none';
    elements.snapToRoadBtn.style.display = 'none';
    if (elements.distanceIndicator) {
        elements.distanceIndicator.style.display = 'none';
    }
    if (elements.routeInfoPanel) elements.routeInfoPanel.classList.add('translate-y-full');
    if (elements.bottomNavbar) elements.bottomNavbar.classList.add('translate-y-full');

    state.isSnapToRoadActive = false;
    elements.snapToRoadBtn.classList.remove('bg-blue-500');
    elements.snapToRoadBtn.classList.add('bg-gray-500');
    elements.snapToRoadBtn.setAttribute('title', 'Snap to Road (Nonaktif)');

    const profile = 'walking';
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/` +
                `${startLng},${startLat};${destLon},${destLat}` +
                `?steps=true&geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const routeGeoJSON = route.geometry;

            map.addSource('route', {
                type: 'geojson',
                data: { type: 'Feature', properties: {}, geometry: routeGeoJSON }
            });

            map.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#3887be', 'line-width': 7, 'line-opacity': 0.8 }
            });

            state.currentRouteLine = routeGeoJSON;

            // Fit Bounds (Zoom ke rute)
            const coordinates = routeGeoJSON.coordinates;
            const bounds = coordinates.reduce((bounds, coord) => bounds.extend(coord), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
            
            // 1. Hentikan paksa animasi kamera "Follow User"
            map.stop();

            // 2. Reset kamera ke mode 2D (Tegak) dan Utara secara INSTAN.
            // Ini penting agar kalkulasi fitBounds tidak kacau karena kemiringan 60 derajat.
            map.jumpTo({ 
                pitch: 0, 
                bearing: 0,
                padding: { top: 0, bottom: 0, left: 0, right: 0 } // Reset padding lama
            });

            // 3. Lakukan Fit Bounds dengan animasi halus
            // Beri sedikit delay (10ms) untuk memastikan jumpTo selesai diproses
            setTimeout(() => {
                map.fitBounds(bounds, { 
                    // Padding: Bottom 320px memberi ruang untuk panel putih di bawah
                    padding: { top: 80, bottom: 260, left: 50, right: 50 }, 
                    pitch: 0,
                    bearing: 0,
                    duration: 1500 // Durasi animasi zoom out ke rute
                });
            }, 10);

            // elements.startNavBtn.style.display = 'flex';
            // 1. Isi Nama Tujuan
            if (elements.routeDestName) elements.routeDestName.textContent = destName;

            // 2. Isi Jarak (dari API Mapbox, satuan meter)
            const distanceKm = (route.distance / 1000).toFixed(1);
            if (elements.routeDestDistance) elements.routeDestDistance.textContent = `${distanceKm} km`;

            // 3. Isi Waktu (dari API Mapbox, satuan detik)
            const durationMin = Math.round(route.duration / 60);
            if (elements.routeDestTime) elements.routeDestTime.textContent = `${durationMin} min`;

            // 4. Munculkan Panel (Slide Up)
            if (elements.routeInfoPanel) elements.routeInfoPanel.classList.remove('translate-y-full');

        } else {
            alert("Tidak dapat menemukan rute.");
            // Kembalikan navbar jika gagal
            if (elements.bottomNavbar) elements.bottomNavbar.classList.remove('translate-y-full');
        }
    } catch (error) {
        console.error('Error fetching route:', error);
        alert("Terjadi kesalahan saat mengambil rute.");
    }
}

export function handleRouteRequest(lat, lon, nama) {
    console.log("Permintaan rute diterima.");
    state.pendingRouteDestination = { lat: lat, lon: lon, nama: nama };
    
    if (state.userLocation) {
        createRoute(mapInstance, lat, lon, nama);
        state.pendingRouteDestination = null; 
    } else {
        console.log("Lokasi belum ada. Memicu geolocate...");
        state.isProgrammaticTrigger = true;
        geolocateControl.trigger(); 
    }
}

function startNavigationMode() {
    state.isNavigating = true;
    state.wasNavigating = false; 
    state.isPreviewingRoute = false;
    
    if (elements.routeInfoPanel) elements.routeInfoPanel.classList.add('translate-y-full');
    // elements.startNavBtn.style.display = 'none';
    elements.cancelNavBtn.style.display = 'flex';
    elements.snapToRoadBtn.style.display = 'flex';
    // Munculkan kembali Tombol Locate & AR
    if (elements.locateButton) elements.locateButton.style.display = 'flex';
    if (elements.arButton) elements.arButton.style.display = 'flex';

    if (elements.distanceIndicator) {
        elements.distanceIndicator.style.display = 'flex';
    }

    if (elements.bottomNavbar) {
        elements.bottomNavbar.classList.add('translate-y-full');
    }
    
    if (state.userLocation) {
        mapInstance.easeTo({
            center: state.userLocation,
            pitch: 60,
            zoom: 19,
            duration: 1000,
            padding: { top: 300 }
        });
        // Paksa geolocate mode jika perlu (opsional karena kita handle manual camera follow)
    } else {
        geolocateControl.trigger();
    }
}

export function cancelNavigationMode() {
    state.isNavigating = false;
    state.wasNavigating = false; 
    state.isPreviewingRoute = false;

    clearTimeout(state.snapBackTimer);
    state.snapBackTimer = null;
    state.currentRouteLine = null;
    
    if (elements.routeInfoPanel) elements.routeInfoPanel.classList.add('translate-y-full');
    // elements.startNavBtn.style.display = 'none';
    elements.cancelNavBtn.style.display = 'none';
    elements.snapToRoadBtn.style.display = 'none';
    if (elements.distanceIndicator) {
        elements.distanceIndicator.style.display = 'none';
        if (elements.distanceText) elements.distanceText.innerText = "0 m";
    }
    
    // Reset Snap UI
    state.isSnapToRoadActive = false;
    elements.snapToRoadBtn.classList.remove('bg-blue-500');
    elements.snapToRoadBtn.classList.add('bg-gray-500');

    if (elements.bottomNavbar) {
        elements.bottomNavbar.classList.remove('translate-y-full');
    }

    if (mapInstance.getLayer('route')) mapInstance.removeLayer('route');
    if (mapInstance.getSource('route')) mapInstance.removeSource('route');

    mapInstance.easeTo({
        center: [config.lonmap, config.latmap],
        zoom: 16.5,
        pitch: 45,
        bearing: -17.6,
        duration: 1000,
        padding: { top: 0, bottom: 0, left: 0, right: 0 }
    });
}

function toggleSnapToRoad() {
    state.isSnapToRoadActive = !state.isSnapToRoadActive;
    console.log("Status Snap to Road:", state.isSnapToRoadActive);

    if (state.isSnapToRoadActive) {
        elements.snapToRoadBtn.classList.remove('bg-gray-500');
        elements.snapToRoadBtn.classList.add('bg-blue-500');
        elements.snapToRoadBtn.setAttribute('title', 'Snap to Road (Aktif)');
    } else {
        elements.snapToRoadBtn.classList.remove('bg-blue-500');
        elements.snapToRoadBtn.classList.add('bg-gray-500');
        elements.snapToRoadBtn.setAttribute('title', 'Snap to Road (Nonaktif)');
    }
}

// --- Snap Back Logic ---

function interruptNavigation() {
    clearTimeout(state.snapBackTimer);
    
    if (state.isNavigating) {
        console.log('User interrupted navigation.');
        state.isNavigating = false;
        state.wasNavigating = true; 
        elements.startNavBtn.style.display = 'none';
    }
}

function startSnapBackTimer() {
    clearTimeout(state.snapBackTimer);
    
    if (state.wasNavigating && mapInstance.getSource('route')) {
        console.log('User stopped. Timer start...');
        elements.cancelNavBtn.style.display = 'flex';
        elements.snapToRoadBtn.style.display = 'flex';
        state.snapBackTimer = setTimeout(() => {
            console.log('Snapping back...');
            startNavigationMode();
        }, 4000); 
    }
}

// ==========================================
// 🛠️ FITUR DEBUGGING: TAP-TO-TELEPORT
// ==========================================

export function setupTeleportDebug(map) {
    const btn = document.getElementById('debug-teleport-btn');
    if (!btn) return;

    let isDebugMode = false;

    // 1. Toggle Mode
    btn.addEventListener('click', () => {
        isDebugMode = !isDebugMode;
        
        if (isDebugMode) {
            btn.classList.replace('bg-gray-800', 'bg-green-600');
            btn.innerHTML = '<i class="fas fa-map-pin"></i> KLIK PETA UNTUK PINDAH';
            alert("Mode Teleport Aktif! \nSilakan klik/tap di mana saja pada garis rute untuk memindahkan posisi Anda secara instan.");
        } else {
            btn.classList.replace('bg-green-600', 'bg-gray-800');
            btn.innerHTML = '<i class="fas fa-magic"></i> MODE TELEPORT';
        }
    });

    // 2. Listener Klik Peta (Hanya jalan jika mode aktif)
    map.on('click', (e) => {
        if (!isDebugMode) return;

        const clickedLngLat = [e.lngLat.lng, e.lngLat.lat];

        // Opsional: Snap ke garis rute agar akurat (jika rute ada)
        let finalLocation = clickedLngLat;
        if (state.currentRouteLine) {
            const pt = turf.point(clickedLngLat);
            const snapped = turf.nearestPointOnLine(state.currentRouteLine, pt);
            finalLocation = snapped.geometry.coordinates;
        }

        console.log("📍 Teleport ke:", finalLocation);

        // A. Update State Utama
        state.userLocation = finalLocation;

        // B. Update Visual Marker 2D
        if (state.userMarker) {
            state.userMarker.setLngLat(finalLocation);
        }

        // C. Update Posisi Kamera Peta
        map.easeTo({ center: finalLocation, duration: 300 });

        // D. (PENTING) Logika AR Navigasi otomatis membaca 'state.userLocation'
        // Jadi panah AR akan langsung berubah saat Anda klik.
    });
}