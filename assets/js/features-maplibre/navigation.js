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
    mapInstance = map; 
    
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

    if (map.getLayer('route')) map.removeLayer('route');
    if (map.getSource('route')) map.removeSource('route');
    
    // Sembunyikan UI yang tidak perlu
    if (elements.compassIndicator) elements.compassIndicator.style.display = 'none';
    if (elements.degreeIndicator) elements.degreeIndicator.style.display = 'none';
    if (elements.locateButton) elements.locateButton.style.display = 'none';
    if (elements.arButton) elements.arButton.style.display = 'none';

    elements.startNavBtn.style.display = 'flex';
    elements.cancelNavBtn.style.display = 'none';
    elements.snapToRoadBtn.style.display = 'none';
    if (elements.distanceIndicator) elements.distanceIndicator.style.display = 'none';
    if (elements.routeInfoPanel) elements.routeInfoPanel.classList.add('translate-y-full');
    if (elements.bottomNavbar) elements.bottomNavbar.classList.add('translate-y-full');

    state.isSnapToRoadActive = false;
    elements.snapToRoadBtn.classList.remove('bg-blue-500');
    elements.snapToRoadBtn.classList.add('bg-gray-500');

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

            const coordinates = routeGeoJSON.coordinates;
            const bounds = coordinates.reduce((bounds, coord) => bounds.extend(coord), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
            
            map.stop();
            map.jumpTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });

            setTimeout(() => {
                map.fitBounds(bounds, { 
                    padding: { top: 80, bottom: 260, left: 50, right: 50 }, 
                    pitch: 0, bearing: 0, duration: 1500 
                });
            }, 10);

            if (elements.routeDestName) elements.routeDestName.textContent = destName;

            // Mapbox memberikan output route.distance dalam satuan meter
            const distMeters = route.distance;
            let distDisplayText;

            if (distMeters < 1000) {
                // Jika di bawah 1km, gunakan meter (bulatkan)
                distDisplayText = `${Math.round(distMeters)} m`;
            } else {
                // Jika 1km atau lebih, gunakan km (1 desimal)
                distDisplayText = `${(distMeters / 1000).toFixed(1)} km`;
            }

            if (elements.routeDestDistance) elements.routeDestDistance.textContent = distDisplayText;

            const durationMin = Math.round(route.duration / 60);
            if (elements.routeDestTime) elements.routeDestTime.textContent = `${durationMin} min`;
            if (elements.routeInfoPanel) elements.routeInfoPanel.classList.remove('translate-y-full');

        } else {
            alert("Tidak dapat menemukan rute.");
            if (elements.bottomNavbar) elements.bottomNavbar.classList.remove('translate-y-full');
        }
    } catch (error) {
        console.error('Error fetching route:', error);
        alert("Terjadi kesalahan saat mengambil rute.");
    }
}

export function handleRouteRequest(lat, lon, nama) {
    state.pendingRouteDestination = { lat: lat, lon: lon, nama: nama };
    if (state.userLocation) {
        createRoute(mapInstance, lat, lon, nama);
        state.pendingRouteDestination = null; 
    } else {
        state.isProgrammaticTrigger = true;
        geolocateControl.trigger(); 
    }
}

function startNavigationMode() {
    state.isNavigating = true;
    state.wasNavigating = false; 
    state.isPreviewingRoute = false;
    
    if (elements.routeInfoPanel) elements.routeInfoPanel.classList.add('translate-y-full');
    elements.cancelNavBtn.style.display = 'flex';
    elements.snapToRoadBtn.style.display = 'flex';
    state.isSnapToRoadActive = true;
    elements.snapToRoadBtn.classList.remove('bg-gray-500');
    elements.snapToRoadBtn.classList.add('bg-blue-500');
    elements.snapToRoadBtn.setAttribute('title', 'Snap to Road (Aktif)');

    if (elements.locateButton) elements.locateButton.style.display = 'flex';
    if (elements.arButton) elements.arButton.style.display = 'flex';

    if (elements.distanceIndicator) elements.distanceIndicator.style.display = 'flex';
    if (elements.bottomNavbar) elements.bottomNavbar.classList.add('translate-y-full');
    
    if (state.userLocation) {
        mapInstance.flyTo({
            center: state.userLocation,
            pitch: 60,
            zoom: 19,
            padding: { top: 300 },
            speed: 1.5,       // Kecepatan terbang
            curve: 1,         // Kurva animasi
            essential: true   // Mencegah animasi dibatalkan oleh interaksi kecil
        });
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
    elements.cancelNavBtn.style.display = 'none';
    elements.snapToRoadBtn.style.display = 'none';
    if (elements.distanceIndicator) {
        elements.distanceIndicator.style.display = 'none';
        if (elements.distanceText) elements.distanceText.innerText = "0 m";
    }
    
    state.isSnapToRoadActive = false;
    elements.snapToRoadBtn.classList.remove('bg-blue-500');
    elements.snapToRoadBtn.classList.add('bg-gray-500');

    if (elements.bottomNavbar) elements.bottomNavbar.classList.remove('translate-y-full');
    if (mapInstance.getLayer('route')) mapInstance.removeLayer('route');
    if (mapInstance.getSource('route')) mapInstance.removeSource('route');

    mapInstance.easeTo({
        center: [config.lonmap, config.latmap],
        zoom: 16.5, pitch: 45, bearing: -17.6, duration: 1000,
        padding: { top: 0, bottom: 0, left: 0, right: 0 }
    });
}

function toggleSnapToRoad() {
    state.isSnapToRoadActive = !state.isSnapToRoadActive;
    if (state.isSnapToRoadActive) {
        elements.snapToRoadBtn.classList.remove('bg-gray-500');
        elements.snapToRoadBtn.classList.add('bg-blue-500');
    } else {
        elements.snapToRoadBtn.classList.remove('bg-blue-500');
        elements.snapToRoadBtn.classList.add('bg-gray-500');
    }
}

function interruptNavigation(e) {
    if (e && e.type === 'zoomstart' && !e.originalEvent) {
        return;
    }

    clearTimeout(state.snapBackTimer);
    
    if (state.isNavigating) {
        console.log("Navigation: User interrupted navigation. Pausing auto-follow...");
        state.isNavigating = false;
        state.wasNavigating = true; 
        elements.startNavBtn.style.display = 'none';
    }
}

function startSnapBackTimer() {
    clearTimeout(state.snapBackTimer);
    if (state.wasNavigating && mapInstance.getSource('route')) {
        console.log("Navigation: User interaction stopped. Starting snap-back timer (4s)...");
        elements.cancelNavBtn.style.display = 'flex';
        elements.snapToRoadBtn.style.display = 'flex';
        state.snapBackTimer = setTimeout(() => {
            console.log("Navigation: Timer finished. Snapping back to navigation mode.");
            startNavigationMode();
        }, 4000); 
    }
}

// ==========================================
// 🛠️ FITUR DEBUGGING: TAP-TO-TELEPORT (DIPINDAHKAN DARI KODE BARU)
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

    // 2. Listener Klik Peta
    map.on('click', (e) => {
        if (!isDebugMode) return;

        const clickedLngLat = [e.lngLat.lng, e.lngLat.lat];

        // Snap ke garis rute agar akurat (jika rute ada)
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
    });
}