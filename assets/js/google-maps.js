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
    let watchId = null; 
    
    // Variabel untuk menyimpan data mentah kompas
    let lastCompassAlpha = 0; 
    let correctedHeading = 0;
    let correctedNeedleHeading = 0;

    // Variabel untuk smoothing kompas
    let smoothedAlpha = null; 
    const smoothingFactor = 0.1; 

    let isNavigating = false;
    let wasNavigating = false;
    let snapBackTimer = null;
    let pendingDestination = null; 
    
    let isProgrammaticMove = false;

    const defaultCenter = new LatLng(-7.5567, 110.7711);
    const defaultZoom = 17;

    const bottomNavbar = document.getElementById('bottom-navbar');
    let hideControlsTimer = null;

    const locateButton = document.getElementById('locate-btn');
    const arButton = document.getElementById('ar-btn');
    const startNavButton = document.getElementById('start-nav-btn');
    const cancelNavButton = document.getElementById('cancel-nav-btn');

    const compassIndicator = document.getElementById('compass-indicator');
    const compassNeedle = document.getElementById('compass-needle');
    const degreeIndicator = document.getElementById('degree-indicator');

    const openSearchBtn = document.getElementById('open-search-btn');
    const closeSearchBtn = document.getElementById('close-search-btn');
    const searchPanel = document.getElementById('search-panel');
    const searchInput = document.getElementById('search-input');
    const allLocationsList = document.getElementById('all-locations-list');
    let allLocationsData = []; 


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


    // --- Listener Interaksi Peta ---
    map.addListener('dragstart', () => {
        interruptNavigation();
        hideMapControls();
    }); 
    
    mapElement.addEventListener('wheel', () => {
        interruptNavigation();
        hideMapControls();
    }, { passive: true });
    
    map.addListener('zoom_changed', hideMapControls);

    // --- Listener Idle Peta ---
    map.addListener('idle', () => {
        if (wasNavigating) {
            startSnapBackTimer();
        }

        // --- Logika Tampilkan Navbar ---
        clearTimeout(hideControlsTimer);
        // 2 detik (2000ms)
        hideControlsTimer = setTimeout(showMapControls, 2000); 
    });

    // Listener Panel Search
    openSearchBtn.addEventListener('click', function() { 
         searchPanel.classList.remove('-translate-y-full');
         searchInput.focus();
    });
    closeSearchBtn.addEventListener('click', function() { 
        searchPanel.classList.add('-translate-y-full');
    });

    allLocationsList.addEventListener('click', function(e) {
         const item = e.target.closest('.location-item');
        if (!item) return; 

        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        const locationBtn = e.target.closest('.location-btn');
        
        if (locationBtn) {
            isProgrammaticMove = true;
            map.setCenter({ lat: lat, lng: lon });
            map.setZoom(19);
            const idleListener = map.addListener('idle', () => {
                isProgrammaticMove = false;
                idleListener.remove();
            });
        } else {
            requestRouteToLocation(lat, lon);
        }
        searchPanel.classList.add('-translate-y-full');
    });

    searchInput.addEventListener('keyup', function(e) { 
        const searchTerm = e.target.value.toLowerCase();
        const items = allLocationsList.getElementsByClassName('location-item');
        Array.from(items).forEach(item => {
            const namaLokasi = item.dataset.nama.toLowerCase(); 
            if (namaLokasi.includes(searchTerm)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    });


    // --- Listener Orientasi + Smoothing ---
    function handleOrientation(event) {
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
            smoothedAlpha = smoothedAlpha % 360;
            if (smoothedAlpha < 0) { smoothedAlpha += 360; }
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
    }
    
    if (window.DeviceOrientationEvent) {
        try {
            window.addEventListener('deviceorientationabsolute', handleOrientation, true);
            console.log("Menggunakan 'deviceorientationabsolute'.");
        } catch (e) {
            window.addEventListener('deviceorientation', handleOrientation, true);
            console.warn("Fallback ke 'deviceorientation' (mungkin tidak akurat).");
        }
    } else {
        console.warn("DeviceOrientationEvent (kompas) tidak didukung di browser ini.");
    }

    map.addListener('heading_changed', updateCompassRotation);


    // --- 5. FUNGSI LOGIKA INTI ---

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

    // --- 7. MULAI PELACAKAN LOKASI SAAT PETA DIMUAT ---
    startWatchingLocation();
}

// Panggil fungsi inisialisasi utama
initMap();