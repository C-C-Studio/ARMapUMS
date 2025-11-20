import { state, config, elements } from './state.js';
import { createRoute, cancelNavigationMode } from './navigation.js'; // Import Circular hati-hati, tapi fungsi aman

let mapInstance = null;
let geolocateControl = null;

export function setupGeolocation(map, geolocateCtrl) {
    mapInstance = map;
    geolocateControl = geolocateCtrl;

    // Setup Listener
    geolocateControl.on('geolocate', onLocationFound);
    geolocateControl.on('error', onLocationError);
    geolocateControl.on('trackuserlocationstart', () => {
        if (state.isProgrammaticTrigger) {
            state.isProgrammaticTrigger = false; 
        } else {
            console.log("Pencarian lokasi manual, rute tertunda dibatalkan.");
            state.pendingRouteDestination = null;
        }
    });

    // Setup Kompas Device Orientation
    startMapOrientationListener();
    map.on('rotate', updateCompassRotation);

    // Listener Tombol Locate
    elements.locateButton.addEventListener('click', () => {
        if (state.userLocation) {
            map.flyTo({
                center: state.userLocation,
                zoom: 19,
                pitch: 60
            });
        } else {
            geolocateControl.trigger();
        }
    });
}

function onLocationFound(e) {
    const userLng = e.coords.longitude;
    const userLat = e.coords.latitude;
    const rawUserLocation = [userLng, userLat];
    let finalLocation;

    // --- Logika Snap-to-Road ---
    if ((state.isNavigating || state.wasNavigating) && state.currentRouteLine && state.isSnapToRoadActive) {
        const userPoint = turf.point(rawUserLocation);
        const snappedResult = turf.pointOnLine(state.currentRouteLine, userPoint);
        finalLocation = snappedResult.geometry.coordinates;
    } else {
        finalLocation = rawUserLocation;
    }

    state.userLocation = finalLocation;

    if (state.isNavigating && state.currentRouteLine) {
        // 1. Ambil koordinat titik terakhir dari rute (Tujuan)
        const routeCoords = state.currentRouteLine.coordinates;
        const destinationCoord = routeCoords[routeCoords.length - 1];

        // 2. Hitung jarak user ke tujuan (menggunakan Turf.js)
        const from = turf.point(state.userLocation);
        const to = turf.point(destinationCoord);
        const options = {units: 'meters'};
        const distanceToDest = turf.distance(from, to, options);

        // 3. Cek jika jarak kurang dari 15 meter
        if (distanceToDest < 15) {
            console.log("User telah sampai di tujuan!");
            
            // Tampilkan Notifikasi
            alert("🎉 Anda telah sampai di tujuan!");
            
            // Hentikan Navigasi Otomatis
            cancelNavigationMode();
            
            // Keluar dari fungsi agar kamera tidak dipaksa bergerak lagi
            return; 
        }
    }

    // Update Marker UI
    if (!state.userMarker) {
        const markerEl = buildUserMarker();
        state.userMarker = new maplibregl.Marker({element: markerEl, anchor: 'center'})
            .setLngLat(state.userLocation)
            .addTo(mapInstance);
    } else {
        state.userMarker.setLngLat(state.userLocation);
    }

    // Camera Follow logic
    if (state.isNavigating && !state.wasNavigating) {
        mapInstance.easeTo({
            center: state.userLocation,
            bearing: state.lastCompassAlpha || 0, // Head Up
            duration: 1000,
            easing: n => n,
            pitch: 60
        });
    }
    
    // Cek area kampus
    const userLngLat = new maplibregl.LngLat(state.userLocation[0], state.userLocation[1]);
    if (isUserOnCampus(userLngLat)) {
        state.isUserOnCampusFlag = true;
        console.log("Status: User di dalam kampus.");
    } else {
        state.isUserOnCampusFlag = false;
        console.log("Status: User di luar kampus.");
        if (!state.pendingRouteDestination) {
            // alert("Anda di luar area kampus."); // Opsional, bisa di-uncomment
        }
    }

    // Handle Pending Route
    if (state.pendingRouteDestination) {
        console.log("Mencoba membuat rute tertunda...");
        createRoute(
            mapInstance,
            state.pendingRouteDestination.lat,
            state.pendingRouteDestination.lon,
            state.pendingRouteDestination.nama
        );
        state.pendingRouteDestination = null;
    }
}

function onLocationError(e) {
    alert("Tidak bisa mendapatkan lokasi. Pastikan GPS aktif.");
    state.pendingRouteDestination = null;
}

function buildUserMarker() {
    const markerEl = document.createElement('div');
    markerEl.className = 'user-location-marker';
    markerEl.innerHTML = `<div class="user-location-heading"></div><div class="user-location-dot"></div>`;
    return markerEl;
}

// --- Logika Kompas ---

function updateRealCompassDegree(degrees) { 
    if (elements.degreeIndicator) {
        elements.degreeIndicator.textContent = `${Math.round(degrees)}°`;
    }
}

export function updateCompassRotation() {
    const mapHeading = mapInstance ? (mapInstance.getBearing() || 0) : 0;

    // Update Jarum Kompas UI (Absolute)
    if (elements.compassNeedle) {
        const targetNeedleHeading = state.lastCompassAlpha; 
        let needleDelta = targetNeedleHeading - state.correctedNeedleHeading;
        if (needleDelta > 180) needleDelta -= 360; 
        else if (needleDelta < -180) needleDelta += 360; 
        state.correctedNeedleHeading += needleDelta * config.smoothingFactor;
        elements.compassNeedle.style.transform = `rotate(${state.correctedNeedleHeading}deg)`;
    }

    // Update Kerucut Marker (Relative to Map)
    if (state.userMarker) {
        const targetConeHeading = state.lastCompassAlpha - mapHeading; 
        let coneDelta = targetConeHeading - state.correctedConeHeading;
        if (coneDelta > 180) coneDelta -= 360; 
        else if (coneDelta < -180) coneDelta += 360; 
        state.correctedConeHeading += coneDelta * config.smoothingFactor;

        const markerEl = state.userMarker.getElement();
        const headingEl = markerEl.querySelector('.user-location-heading');
        if (headingEl) {
            headingEl.style.transform = `translate(-50%, -50%) rotate(${state.correctedConeHeading}deg)`;
        }
    }
}

function handleMapOrientation(event) {
    let alpha = event.webkitCompassHeading || event.alpha;
    if (alpha == null) return;
    
    const correctedAlpha = (360 - alpha) % 360;
    
    if (state.smoothedAlpha === null) {
        state.smoothedAlpha = correctedAlpha;
    } else {
        let diff = correctedAlpha - state.smoothedAlpha;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        state.smoothedAlpha += diff * config.smoothingFactor;
        state.smoothedAlpha = (state.smoothedAlpha % 360 + 360) % 360;
    }
    
    state.lastCompassAlpha = state.smoothedAlpha; 
    updateRealCompassDegree(state.smoothedAlpha);
    
    if (elements.compassIndicator) elements.compassIndicator.style.display = 'flex';
    if (elements.degreeIndicator) elements.degreeIndicator.style.display = 'flex';
    
    updateCompassRotation();
}

function startMapOrientationListener() {
    if (window.DeviceOrientationEvent) {
        try {
            window.addEventListener('deviceorientationabsolute', handleMapOrientation, true);
        } catch (e) {
            window.addEventListener('deviceorientation', handleMapOrientation, true);
        }
    }
}