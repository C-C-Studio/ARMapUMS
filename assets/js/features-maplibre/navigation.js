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
    
    elements.startNavBtn.style.display = 'none';
    elements.cancelNavBtn.style.display = 'none';
    elements.snapToRoadBtn.style.display = 'none';

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
            const routeGeoJSON = data.routes[0].geometry;

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
            const bounds = coordinates.reduce((bounds, coord) => {
                return bounds.extend(coord);
            }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

            map.fitBounds(bounds, { padding: 40 });
            elements.startNavBtn.style.display = 'flex';

        } else {
            alert("Tidak dapat menemukan rute.");
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
    
    elements.startNavBtn.style.display = 'none';
    elements.cancelNavBtn.style.display = 'flex';
    elements.snapToRoadBtn.style.display = 'flex';

    if (elements.bottomNavbar) {
        elements.bottomNavbar.classList.add('translate-y-full');
    }
    
    if (state.userLocation) {
        mapInstance.easeTo({
            center: state.userLocation,
            pitch: 60,
            zoom: 19,
            duration: 1000
        });
        // Paksa geolocate mode jika perlu (opsional karena kita handle manual camera follow)
    } else {
        geolocateControl.trigger();
    }
}

export function cancelNavigationMode() {
    state.isNavigating = false;
    state.wasNavigating = false; 
    clearTimeout(state.snapBackTimer);
    state.snapBackTimer = null;
    state.currentRouteLine = null;

    elements.startNavBtn.style.display = 'none';
    elements.cancelNavBtn.style.display = 'none';
    elements.snapToRoadBtn.style.display = 'none';
    
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
        duration: 1000
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