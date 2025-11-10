"use strict";
/*
 * @license
 * Copyright 2025 Google LLC. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Impor modul geofence dari file sebelah
import { initGeofence, isUserOnCampus } from './geofence-google.js';

async function initMap() {
    
    // --- 1. MEMINTA SEMUA LIBRARY ---
    const [{ Map, InfoWindow }, { AdvancedMarkerElement }, { DirectionsService, DirectionsRenderer }] = await Promise.all([
        google.maps.importLibrary("maps"),
        google.maps.importLibrary("marker"),
        google.maps.importLibrary("routes"), 
    ]);

    const { LatLng, LatLngBounds } = google.maps;

    // Inisialisasi modul geofence
    await initGeofence();
    
    const mapElement = document.querySelector('gmp-map'); 
    const map = mapElement.innerMap;
    
    map.setOptions({
        mapTypeControl: false,
        streetViewControl: false,
        zoomControl: false,
    });
    
    // --- 2. INISIALISASI SERVICE RUTE ---
    const directionsService = new DirectionsService();
    const directionsRenderer = new DirectionsRenderer();
    directionsRenderer.setMap(map); 
    directionsRenderer.setOptions({ suppressMarkers: true });


    // --- 3. VARIABEL STATUS & REFERENSI ELEMEN ---
    let userMarker = null;
    let userPosition = null;
    let watchId = null; // ID sensor untuk PETA
    
    let lastCompassAlpha = 0; 
    let correctedHeading = 0;
    let correctedNeedleHeading = 0;
    let smoothedAlpha = null; 
    const smoothingFactor = 0.1; 

    let isNavigating = false;
    let wasNavigating = false;
    let snapBackTimer = null;
    let pendingDestination = null; 
    let isProgrammaticMove = false;
    
    let isArModeActive = false; 

    const defaultCenter = new LatLng(-7.5567, 110.7711);
    const defaultZoom = 17;

    const bottomNavbar = document.getElementById('bottom-navbar');
    let hideControlsTimer = null;

    // Tombol-tombol Peta
    const locateButton = document.getElementById('locate-btn');
    const startNavButton = document.getElementById('start-nav-btn');
    const cancelNavButton = document.getElementById('cancel-nav-btn');
    
    // Elemen Kompas Peta
    const compassIndicator = document.getElementById('compass-indicator');
    const compassNeedle = document.getElementById('compass-needle');
    const degreeIndicator = document.getElementById('degree-indicator');

    // Elemen Panel Search
    const openSearchBtn = document.getElementById('open-search-btn');
    const closeSearchBtn = document.getElementById('close-search-btn');
    const searchPanel = document.getElementById('search-panel');
    const searchInput = document.getElementById('search-input');
    const allLocationsList = document.getElementById('all-locations-list');
    let allLocationsData = []; 

    // Referensi Elemen AR
    const arButton = document.getElementById('ar-btn'); 
    const arContainer = document.getElementById('ar-container');
    const arStartButton = document.getElementById('ar-start-button');
    const closeArButton = document.getElementById('close-ar-btn');


    // --- 4. EVENT LISTENERS ---
    
    locateButton.addEventListener('click', () => {
        startWatchingLocation(); 
        if (userPosition) {
            isProgrammaticMove = true;
            map.setCenter(userPosition);
            map.setZoom(19);
            
            const idleListener = map.addListener('idle', () => {
                isProgrammaticMove = false;
                idleListener.remove();
            });
        }
    });
    
    startNavButton.addEventListener('click', () => {
        if (pendingDestination && userPosition) {
            startNavigationMode(); 
        } else {
            alert('Lokasi Anda atau tujuan belum siap untuk memulai navigasi.');
        }
    });

    cancelNavButton.addEventListener('click', () => {
        directionsRenderer.setDirections({ routes: [] }); 
        pendingDestination = null;
        
        cancelNavButton.style.display = 'none';
        startNavButton.style.display = 'none';
        
        cancelNavigationMode(); 
    });

    map.addListener('dragstart', () => {
        interruptNavigation();
        hideMapControls();
    }); 
    mapElement.addEventListener('wheel', () => {
        interruptNavigation();
        hideMapControls();
    }, { passive: true });
    map.addListener('zoom_changed', hideMapControls);
    map.addListener('idle', () => {
        if (wasNavigating) {
            startSnapBackTimer();
        }
        clearTimeout(hideControlsTimer);
        if (!isArModeActive) {
            hideControlsTimer = setTimeout(showMapControls, 2000); 
        }
    });

    openSearchBtn.addEventListener('click', () => { 
         searchPanel.classList.remove('-translate-y-full');
         searchInput.focus();
    });
    closeSearchBtn.addEventListener('click', () => { 
        searchPanel.classList.add('-translate-y-full');
    });
    allLocationsList.addEventListener('click', (e) => { 
         const item = e.target.closest('.location-item');
        if (!item) return; 
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        const locationBtn = e.target.closest('.location-btn');
        if (locationBtn) {
            isProgrammaticMove = true;
            map.setCenter({ lat: lat, lng: lon });
            map.setZoom(19);
            const idleListener = map.addListener('idle', () => { isProgrammaticMove = false; idleListener.remove(); });
        } else {
            requestRouteToLocation(lat, lon);
        }
        searchPanel.classList.add('-translate-y-full');
    });
    searchInput.addEventListener('keyup', (e) => { 
        const searchTerm = e.target.value.toLowerCase();
        const items = allLocationsList.getElementsByClassName('location-item');
        Array.from(items).forEach(item => {
            const namaLokasi = item.dataset.nama.toLowerCase(); 
            if (namaLokasi.includes(searchTerm)) { item.style.display = 'flex'; } else { item.style.display = 'none'; }
        });
    });

    arButton.addEventListener('click', switchToAR);
    closeArButton.addEventListener('click', switchToMap);
    
    // --- Listener Orientasi PETA ---
    function handleMapOrientation(event) {
        let alpha = event.webkitCompassHeading || event.alpha;
        if (alpha == null) return;
        const correctedAlpha = (360 - alpha) % 360;
        
        if (smoothedAlpha === null) {
            smoothedAlpha = correctedAlpha;
        } else {
            let diff = correctedAlpha - smoothedAlpha
            if (diff > 180) { diff -= 360; }
            if (diff < -180) { diff += 360; }
            smoothedAlpha += diff * smoothingFactor;
            smoothedAlpha = (smoothedAlpha % 360 + 360) % 360; // Normalisasi
        }
        
        lastCompassAlpha = smoothedAlpha; 
        updateRealCompassDegree(smoothedAlpha);
        
        if (compassIndicator && compassIndicator.style.display === 'none') {
            compassIndicator.style.display = 'flex';
        }
        if (degreeIndicator && degreeIndicator.style.display === 'none') {
            degreeIndicator.style.display = 'flex';
        }
        updateCompassRotation();
        
        if (isArModeActive) {
            arLogic.feedOrientation(smoothedAlpha);
        }
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
    
    function stopMapOrientationListener() {
        window.removeEventListener('deviceorientationabsolute', handleMapOrientation, true);
        window.removeEventListener('deviceorientation', handleMapOrientation, true);
    }

    map.addListener('heading_changed', updateCompassRotation);


    // --- 5. FUNGSI LOGIKA INTI (PETA) ---
    function createLocationListItem(lokasi) { 
        const itemDiv = document.createElement('div');
        itemDiv.className = 'location-item bg-[#1f3a5f] rounded-xl p-4 flex items-center gap-4 cursor-pointer';
        itemDiv.dataset.nama = lokasi.nama.toLowerCase(); 
        itemDiv.dataset.lat = lokasi.lat;
        itemDiv.dataset.lon = lokasi.lon;
        itemDiv.dataset.nama = lokasi.nama;
        const initial = lokasi.nama.charAt(0).toUpperCase() || 'L';
        itemDiv.innerHTML = `
            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center font-bold">
                ${initial}
            </div>
            <div class="flex-grow min-w-0">
                <h3 class="text-white font-semibold truncate">${lokasi.nama}</h3>
                <p class="text-gray-300 text-sm truncate">${lokasi.deskripsi}</p>
            </div>
            <div class="flex-shrink-0 flex gap-2">
                <button title="Show Location" data-lat="${lokasi.lat}" data-lon="${lokasi.lon}" class="location-btn w-9 h-9 bg-gray-600/50 text-white rounded-lg flex items-center justify-center">
                    <i class="fas fa-location-dot"></i>
                </button>
                <button title="Create Route" data-lat="${lokasi.lat}" data-lon="${lokasi.lon}" data-nama="${lokasi.nama}" class="route-btn w-9 h-9 bg-gray-600/50 text-white rounded-lg flex items-center justify-center">
                    <i class="fas fa-route"></i>
                </button>
            </div>
        `;
        return itemDiv;
    }
    function updateRealCompassDegree(degrees) { 
        if (degreeIndicator) {
            const roundedDegrees = Math.round(degrees);
            degreeIndicator.textContent = `${roundedDegrees}°`;
        }
    }
    function updateCompassRotation() { 
        if (!userMarker) return;
        const mapHeading = map.getHeading() || 0; 
        const targetConeHeading = lastCompassAlpha - mapHeading;
        let coneDelta = targetConeHeading - correctedHeading;
        if (coneDelta > 180) { coneDelta -= 360; } else if (coneDelta < -180) { coneDelta += 360; }
        correctedHeading += coneDelta;
        const headingEl = userMarker.content.querySelector('.user-location-heading');
        if (headingEl) {
            headingEl.style.transform = `translate(-50%, -50%) rotate(${correctedHeading}deg)`;
        }
        const targetNeedleHeading = correctedHeading + mapHeading;
        let needleDelta = targetNeedleHeading - correctedNeedleHeading;
        if (needleDelta > 180) { needleDelta -= 360; } else if (needleDelta < -180) { needleDelta += 360; }
        correctedNeedleHeading += needleDelta;
        if (compassNeedle) {
            compassNeedle.style.transform = `rotate(${correctedNeedleHeading}deg)`;
        }
    }
    function startWatchingLocation() { 
        if (watchId) return; 
        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(
                updateUserLocation, 
                handleLocationError,  
                { enableHighAccuracy: true } 
            );
        } else {
            alert('Error: Browser Anda tidak mendukung Geolocation.');
        }
    }
    function updateUserLocation(position) { 
        const { latitude, longitude } = position.coords; 
        userPosition = new LatLng(latitude, longitude);
        if (!isUserOnCampus(userPosition)) {
            // console.warn('Anda terdeteksi berada di luar area kampus.');
        }
        if (!userMarker) {
            userMarker = new AdvancedMarkerElement({
                map: map,
                content: buildUserMarker(),
                title: 'Lokasi Anda',
                zIndex: 100
            });
        }
        userMarker.position = userPosition;
        updateCompassRotation(); 
        if (isNavigating) {
            isProgrammaticMove = true;
            map.setCenter(userPosition); 
            const idleListener = map.addListener('idle', () => {
                isProgrammaticMove = false;
                idleListener.remove();
            });
        }
        if (isArModeActive) {
            arLogic.feedLocation(position);
        }
    }
    function calculateAndDisplayRoute(origin, destination) { 
        const request = {
            origin: origin,
            destination: destination,
            travelMode: google.maps.TravelMode.WALKING,
        };
        directionsService.route(request)
            .then((response) => {
                directionsRenderer.setDirections(response); 
                startNavButton.style.display = 'flex'; 
                cancelNavButton.style.display = 'none'; 
                const bounds = new LatLngBounds(); 
                if (response.routes[0] && response.routes[0].legs) {
                    response.routes[0].legs.forEach(leg => {
                        leg.steps.forEach(step => {
                            step.path.forEach(pathPoint => {
                                bounds.extend(pathPoint);
                            });
                        });
                    });
                    isProgrammaticMove = true;
                    map.fitBounds(bounds, 100); 
                    const idleListener = map.addListener('idle', () => {
                        isProgrammaticMove = false;
                        idleListener.remove();
                    });
                }
            })
            .catch((e) => {
                console.error("DirectionsService gagal:", e);
                window.alert('Permintaan rute gagal: ' + e);
            });
    }
    function requestRouteToLocation(lat, lon) { 
        if (!userPosition) {
            alert('Silakan tekan tombol "Locate Me" terlebih dahulu untuk menentukan lokasi Anda.');
            startWatchingLocation(); 
            return;
        }
        const destination = new LatLng(lat, lon);
        pendingDestination = destination; 
        calculateAndDisplayRoute(userPosition, destination);
    }
    function startNavigationMode() { 
        isNavigating = true;
        wasNavigating = false;
        clearTimeout(snapBackTimer);
        startNavButton.style.display = 'none';   
        cancelNavButton.style.display = 'flex';  
        startWatchingLocation();
        if (userPosition) {
            isProgrammaticMove = true; 
            map.setCenter(userPosition);
            map.setTilt(60);
            map.setZoom(19);
            const idleListener = map.addListener('idle', () => {
                console.log("Programmatic move (snap-back) finished. Resetting flag.");
                isProgrammaticMove = false;
                idleListener.remove(); 
            });
        }
    }
    function cancelNavigationMode() { 
        isNavigating = false;
        wasNavigating = false;
        clearTimeout(snapBackTimer);
        snapBackTimer = null;
        isProgrammaticMove = true;
        map.setCenter(defaultCenter);
        map.setZoom(defaultZoom);
        map.setTilt(0); 
        const idleListener = map.addListener('idle', () => {
            isProgrammaticMove = false;
            idleListener.remove();
        });
    }
    function interruptNavigation() { 
        if (isProgrammaticMove) {
            console.log("Ignoring programmatic move...");
            return; 
        }
        clearTimeout(snapBackTimer);
        if (isNavigating) {
            console.log('User interrupted navigation.');
            isNavigating = false;
            wasNavigating = true; 
        }
        if (cancelNavButton.style.display === 'flex') {
             cancelNavButton.style.display = 'none';
        }
    }
    function startSnapBackTimer() { 
        if (isProgrammaticMove) {
            return;
        }
        clearTimeout(snapBackTimer);
        if (wasNavigating && directionsRenderer.getDirections()?.routes.length > 0) {
            console.log('User stopped. Starting 4-second snap-back timer...');
            cancelNavButton.style.display = 'flex';
            snapBackTimer = setTimeout(() => {
                console.log('Timer finished. Snapping back to navigation.');
                startNavigationMode(); 
            }, 4000); 
        } else {
            wasNavigating = false;
        }
    }
    function hideMapControls() { 
        if (bottomNavbar) {
            clearTimeout(hideControlsTimer);
            bottomNavbar.classList.add('translate-y-full');
        }
    }
    function showMapControls() { 
        if (bottomNavbar) {
            bottomNavbar.classList.remove('translate-y-full');
        }
    }
    function buildUserMarker() { 
        const markerEl = document.createElement('div');
        markerEl.className = 'user-location-marker';
        const headingEl = document.createElement('div');
        headingEl.className = 'user-location-heading';
        const dotEl = document.createElement('div');
        dotEl.className = 'user-location-dot';
        markerEl.appendChild(headingEl);
        markerEl.appendChild(dotEl);     
        return markerEl;
    }
    function handleLocationError(error) { 
        let message = "Error: ";
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message += "Anda menolak permintaan Geolocation.";
                break;
            case error.POSITION_UNAVAILABLE:
                message += "Informasi lokasi tidak tersedia.";
                break;
            case error.TIMEOUT:
                message += "Permintaan lokasi timeout.";
                break;
            case error.UNKNOWN_ERROR:
                message += "Terjadi error yang tidak diketahui.";
                break;
        }
        alert(message);
        if (error.code === error.PERMISSION_DENIED && watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
    }


    // --- 6. MEMUAT LOKASI DARI JSON ---
    try {
        const response = await fetch('assets/data/location.json'); 
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const locations = await response.json();
        allLocationsData = locations;
        allLocationsList.innerHTML = ''; 
        locations.forEach(location => {
            const marker = new AdvancedMarkerElement({
                map: map,
                position: { lat: location.lat, lng: location.lon },
                title: location.nama,
            });
            marker.addListener('click', () => {
                requestRouteToLocation(location.lat, location.lon);
            });
            const listItem = createLocationListItem(location);
            allLocationsList.appendChild(listItem);
        });
    } catch (error) {
        console.error("Gagal memuat atau mem-parsing location.json:", error);
    }
    

    // --- 7. LOGIKA UNTUK AR MODE ---
    const arLogic = {
        debugUI: document.getElementById('ar-debug-ui'),
        camera: document.getElementById('cam'),
        targetRumah: document.getElementById('target-rumah'),
        arrow: document.getElementById('arrow'),
        startButton: document.getElementById('ar-start-button'),
        targetLat: -7.5431893, 
        targetLon: 110.7698389,
        currentLat: 0,
        currentLon: 0,
        currentAccuracy: 0,
        currentHeading: null, 
        init: function() {
            this.startButton.addEventListener('click', () => {
                this.startButton.style.display = 'none';
                this.debugUI.style.display = 'block';
                if (typeof(DeviceOrientationEvent) !== 'undefined' && typeof(DeviceOrientationEvent.requestPermission) === 'function') {
                    DeviceOrientationEvent.requestPermission()
                        .then(response => {
                            if (response === 'granted') {
                                console.log("Izin kompas AR diberikan (iOS).");
                            } else {
                                this.debugUI.innerHTML = '<span style="color: red;">Izin Kompas ditolak.</span>';
                            }
                        })
                        .catch(() => console.log("Izin kompas AR tidak diperlukan (Android)."));
                } else {
                    console.log("Izin kompas AR tidak diperlukan (Android).");
                }
            });
        },
        feedLocation: function(position) {
            this.currentLat = position.coords.latitude;
            this.currentLon = position.coords.longitude;
            this.currentAccuracy = position.coords.accuracy;
            this.updateTargetPosition();
        },
        feedOrientation: function(heading) {
            this.currentHeading = heading;
            this.updateTargetPosition();
        },
        updateTargetPosition: function() {
            if (this.currentLat === 0 || this.currentHeading === null) return; 
            const distance = this.getDistance(this.currentLat, this.currentLon, this.targetLat, this.targetLon);
            const bearing = this.getBearing(this.currentLat, this.currentLon, this.targetLat, this.targetLon);
            let relativeAngle = bearing - this.currentHeading;
            if (relativeAngle > 180) relativeAngle -= 360;
            if (relativeAngle < -180) relativeAngle += 360;
            const angleInRadians = relativeAngle * (Math.PI / 180);
            const safeDistance = Math.max(1, Math.min(distance, 49000));
            const posZ = -Math.cos(angleInRadians) * safeDistance;
            const posX = Math.sin(angleInRadians) * safeDistance;
            this.targetRumah.setAttribute('position', `${posX} 1.6 ${posZ}`);
            this.targetRumah.setAttribute('value', `Rumah Saya\n${distance.toFixed(0)} m`);
            const fovThreshold = 30;
            const minArrowDistance = 10;
            if (Math.abs(relativeAngle) > fovThreshold && distance > minArrowDistance) {
                this.arrow.setAttribute('visible', 'true');
                this.arrow.setAttribute('rotation', `-90 ${relativeAngle} 0`);
            } else {
                this.arrow.setAttribute('visible', 'false');
            }
            this.debugUI.innerHTML = `
              Lat: ${this.currentLat.toFixed(6)}<br>
              Lon: ${this.currentLon.toFixed(6)}<br>
              Akurasi: ${this.currentAccuracy.toFixed(1)} m<br>
              Kompas: ${this.currentHeading.toFixed(1)}°<br>
              Jarak: ${distance.toFixed(1)} m<br>
              Bearing: ${bearing.toFixed(1)}°<br>
              Rel. Sudut: ${relativeAngle.toFixed(1)}°
            `;
        },
        getDistance: function(lat1, lon1, lat2, lon2) {
            const R = 6371000;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c;
        },
        getBearing: function(lat1, lon1, lat2, lon2) {
            lat1 = lat1 * Math.PI / 180; lon1 = lon1 * Math.PI / 180;
            lat2 = lat2 * Math.PI / 180; lon2 = lon2 * Math.PI / 180;
            const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
            const brng = Math.atan2(y, x) * 180 / Math.PI;
            return (brng + 360) % 360;
        }
    };
    arLogic.init();

    // --- 8. FUNGSI PERGANTIAN MODE ---
    
    function switchToAR() {
        console.log("Beralih ke Mode AR...");
        isArModeActive = true; 
        
        bottomNavbar.classList.add('translate-y-full');
        
        arContainer.style.display = 'block';
        arButton.style.display = 'none';
        
        arContainer.style.pointerEvents = 'none';
        arStartButton.style.pointerEvents = 'auto';
        closeArButton.style.pointerEvents = 'auto';
        
        arContainer.style.height = '70%'; // 70% AR
        
        locateButton.style.display = 'none';

        // --- PERBAIKAN DI SINI (1) ---
        // Ganti kelas posisi tombol navigasi
        startNavButton.classList.remove('bottom-52');
        cancelNavButton.classList.remove('bottom-52');
        startNavButton.classList.add('bottom-4'); // 1rem from bottom
        cancelNavButton.classList.add('bottom-4'); // 1rem from bottom

        mapElement.style.top = '70%'; 
        mapElement.style.height = '30%'; // 30% Peta

        console.log("Sensor Peta tetap berjalan untuk mini-map.");
        console.log("Mode AR siap. Menunggu pengguna menekan 'Mulai AR'.");
    }

    function switchToMap() {
        console.log("Kembali ke Mode Peta...");
        isArModeActive = false; 

        bottomNavbar.classList.remove('translate-y-full');

        arContainer.style.display = 'none';
        arButton.style.display = 'flex'; 

        arContainer.style.pointerEvents = 'auto';
        
        arContainer.style.height = '100%';
        locateButton.style.display = 'flex';

        // --- PERBAIKAN DI SINI (2) ---
        // Kembalikan kelas posisi tombol navigasi
        startNavButton.classList.remove('bottom-4');
        cancelNavButton.classList.remove('bottom-4');
        startNavButton.classList.add('bottom-52');
        cancelNavButton.classList.add('bottom-52');
        
        mapElement.style.top = '0';
        mapElement.style.height = '100%';

        arLogic.debugUI.style.display = 'none'; 
        arLogic.startButton.style.display = 'block'; 

        console.log("Sensor Peta sudah berjalan.");
    }


    // --- 9. MULAI PELACAKAN LOKASI (PETA) SAAT AWAL DIMUAT ---
    startWatchingLocation();
    startMapOrientationListener();
}

initMap();