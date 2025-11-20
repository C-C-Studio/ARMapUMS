"use strict";
/*
 * @license
 * Copyright 2025 Google LLC. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Impor modul geofence dari file sebelah
import { initGeofence, isUserOnCampus } from './geofence-google.js';

// THREE.js sebagai ES module (gunakan hanya satu import)
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";





// 🔽 tambahkan ini
const arMapOverlay = document.getElementById('ar-map-overlay');
const arMapInner = document.getElementById('ar-map-inner');
let arMiniMap = null;
let arMiniDirectionsRenderer = null;
let arMiniUserMarker = null;



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

    // 🔄 Heading yang akan dipakai AR
    let arHeading = 0;

    let isNavigating = false;
    let wasNavigating = false;

    let isSnapToRoadActive = false; 
    let currentRouteLine = null;

    let snapBackTimer = null;
    let pendingDestination = null; 
    let isProgrammaticMove = false; 

    const defaultCenter = new LatLng(-7.5567, 110.7711);
    const defaultZoom = 17;

    const bottomNavbar = document.getElementById('bottom-navbar');
    let hideControlsTimer = null;

    // Tombol-tombol Peta
    const locateButton = document.getElementById('locate-btn');
    const startNavButton = document.getElementById('start-nav-btn');
    const cancelNavButton = document.getElementById('cancel-nav-btn');
    const snapToRoadBtn = document.getElementById('snap-to-road-btn');
    
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
    const arContainer = document.getElementById('ar-container')
    const closeArButton = document.getElementById('close-ar-btn');

    function setARButtonEnabled(enabled) {
        if (!arButton) return;
        if (enabled) {
            arButton.disabled = false;
            arButton.classList.remove('opacity-40', 'pointer-events-none');
        } else {
            arButton.disabled = true;
            arButton.classList.add('opacity-40', 'pointer-events-none');
        }
    }



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

    snapToRoadBtn.addEventListener('click', toggleSnapToRoad);

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
    // SESUDAH
    map.addListener('idle', () => {
        if (wasNavigating) {
            startSnapBackTimer();
        }
        clearTimeout(hideControlsTimer);
        hideControlsTimer = setTimeout(showMapControls, 2000); 
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
            let diff = correctedAlpha - smoothedAlpha;
            if (diff > 180) { diff -= 360; }
            if (diff < -180) { diff += 360; }
            smoothedAlpha += diff * smoothingFactor;
            smoothedAlpha = (smoothedAlpha % 360 + 360) % 360;
        }
        
        lastCompassAlpha = smoothedAlpha; 

        // 🔄 SIMPAN UNTUK AR
        arHeading = smoothedAlpha;
        // opsional: global untuk debugging
        window.__UMS_AR_HEADING = smoothedAlpha;

        updateRealCompassDegree(smoothedAlpha);
        
        if (compassIndicator && compassIndicator.style.display === 'none') {
            compassIndicator.style.display = 'flex';
        }
        if (degreeIndicator && degreeIndicator.style.display === 'none') {
            degreeIndicator.style.display = 'flex';
        }
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
        if (!userMarker && !arMiniUserMarker) return;

        const mapHeading = map.getHeading() || 0; 
        const targetConeHeading = lastCompassAlpha - mapHeading;
        let coneDelta = targetConeHeading - correctedHeading;
        if (coneDelta > 180) { coneDelta -= 360; } 
        else if (coneDelta < -180) { coneDelta += 360; }
        correctedHeading += coneDelta;

        // 🔁 update cone di semua marker yang ada
        const markers = [userMarker, arMiniUserMarker].filter(Boolean);
        for (const m of markers) {
            const headingEl = m.content.querySelector('.user-location-heading');
            if (headingEl) {
                headingEl.style.transform = `translate(-50%, -50%) rotate(${correctedHeading}deg)`;
            }
        }

        const targetNeedleHeading = correctedHeading + mapHeading;
        let needleDelta = targetNeedleHeading - correctedNeedleHeading;
        if (needleDelta > 180) { needleDelta -= 360; } 
        else if (needleDelta < -180) { needleDelta += 360; }
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

        // 1. Simpan posisi mentah dulu
        let finalLat = latitude;
        let finalLng = longitude;

        // --- BARU: Logika Snap to Road ---
        // Cek: Navigasi Aktif? + Fitur Aktif? + Ada Data Rute? + Navigasi tidak sedang dijeda (wasNavigating)?
        if ((isNavigating || wasNavigating) && isSnapToRoadActive && currentRouteLine) {
            const userPoint = turf.point([longitude, latitude]); // [lng, lat]
            
            // Cari titik terdekat di garis rute
            const snapped = turf.nearestPointOnLine(currentRouteLine, userPoint);
            
            // Ambil koordinat hasil snap
            const [snappedLng, snappedLat] = snapped.geometry.coordinates;
            
            finalLat = snappedLat;
            finalLng = snappedLng;
        }
        
        userPosition = new LatLng(finalLat, finalLng);

        if (!isUserOnCampus(userPosition)) {
            // console.warn('Anda terdeteksi berada di luar area kampus.');
        }

        // marker di MAP UTAMA
        if (!userMarker) {
            userMarker = new AdvancedMarkerElement({
                map: map,
                content: buildUserMarker(),
                title: 'Lokasi Anda',
                zIndex: 100
            });
        }
        userMarker.position = userPosition;

        // marker di MINI MAP (mode AR)
        if (arMiniMap) {
            if (!arMiniUserMarker) {
                arMiniUserMarker = new AdvancedMarkerElement({
                    map: arMiniMap,
                    content: buildUserMarker(),   // bentuk & cone sama
                    title: 'Lokasi Anda (AR)',
                    zIndex: 100
                });
            }
            arMiniUserMarker.position = userPosition;
            arMiniMap.setCenter(userPosition);
        }

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

    // Haversine distance (meters)
    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // m
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1)*Math.PI/180;
        const Δλ = (lon2-lon1)*Math.PI/180;
        const a = Math.sin(Δφ/2)*Math.sin(Δφ/2) + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)*Math.sin(Δλ/2);
        const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R*c;
    }

    function signedAngleDiff(a, b) {
        // returns signed (a - b) normalized to [-180,180]
        let diff = (a - b + 540) % 360 - 180;
        return diff;
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
                try {
                    const route = response.routes[0];
                    // overview_path berisi array LatLng yang disederhanakan
                    const path = route.overview_path; 
                    
                    // Turf butuh format [lng, lat] (kebalik dari Google)
                    const turfCoords = path.map(p => [p.lng(), p.lat()]);
                    
                    currentRouteLine = turf.lineString(turfCoords);
                    console.log("Rute Turf.js berhasil dibuat untuk Snap to Road");
                } catch (e) {
                    console.warn("Gagal membuat rute Turf.js:", e);
                    currentRouteLine = null;
                }

                // 🔽 gambar rute juga di mini map kalau sudah dibuat
                // ---- parse route into points & segments for AR guidance ----
                (function parseRouteForAR(resp) {
                    try {
                        routePoints = [];
                        routeDistances = [];
                        routeBearings = [];
                        turnPoints = [];

                        const route = resp.routes[0];
                        if (!route) return;

                        // collect all path points from legs -> steps -> path
                        const legs = route.legs || [];
                        for (const leg of legs) {
                            for (const step of leg.steps || []) {
                                for (const p of step.path || []) {
                                    // p may be LatLng object or literal; normalize
                                    const lat = (typeof p.lat === 'function') ? p.lat() : p.lat;
                                    const lng = (typeof p.lng === 'function') ? p.lng() : p.lng;
                                    routePoints.push({ lat, lng });
                                }
                            }
                        }

                        // compute cumulative distances and segment bearings
                        let cum = 0;
                        routeDistances = [0];
                        for (let i = 0; i < routePoints.length - 1; i++) {
                            const a = routePoints[i];
                            const b = routePoints[i+1];
                            const segDist = haversineDistance(a.lat, a.lng, b.lat, b.lng);
                            cum += segDist;
                            routeDistances.push(cum);

                            const brng = computeBearing(a, b);
                            routeBearings.push(brng);
                        }

                        // detect turns: compare bearing change between consecutive segments
                        for (let i = 0; i < routeBearings.length - 1; i++) {
                            const b1 = routeBearings[i];
                            const b2 = routeBearings[i+1];
                            const delta = signedAngleDiff(b2, b1); // signed diff
                            if (Math.abs(delta) >= TURN_ANGLE_THRESHOLD) {
                                // record turn at point index i+1 (between segment i and i+1)
                                const turnIndex = i + 1;
                                const turnDistance = routeDistances[turnIndex];
                                turnPoints.push({
                                    index: turnIndex,
                                    distance: turnDistance,
                                    bearing: b2,
                                    turnAngle: delta
                                });
                            }
                        }

                        if (AR_DEBUG) console.log('Parsed route for AR:', { points: routePoints.length, turnPoints });
                    } catch (e) {
                        console.warn('parseRouteForAR failed', e);
                    }
                })(response);

                if (arMiniDirectionsRenderer) {
                    arMiniDirectionsRenderer.setDirections(response);
                }
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

        // Cek jika ada rute aktif, rute dijeda, atau rute tergambar di peta
        if (isNavigating || wasNavigating || (directionsRenderer.getDirections() && directionsRenderer.getDirections().routes.length > 0)) {
            if (AR_DEBUG) console.log('Rute lama dibatalkan untuk membuat rute baru.');
            
            // 1. Hapus rute lama dari peta
            directionsRenderer.setDirections({ routes: [] }); 
            
            // 2. Reset semua status navigasi
            pendingDestination = null;
            isNavigating = false;
            wasNavigating = false;
            clearTimeout(snapBackTimer);
            
            // 3. Sembunyikan tombol-tombol navigasi (akan dimunculkan lagi oleh rute baru)
            cancelNavButton.style.display = 'none';
            startNavButton.style.display = 'none';
            snapToRoadBtn.style.display = 'none';
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
        snapToRoadBtn.style.display = 'flex';
        setARButtonEnabled(true);  
        startWatchingLocation();
        if (userPosition) {
            isProgrammaticMove = true; 
            map.setCenter(userPosition);
            map.setTilt(60);
            map.setZoom(19);
            const idleListener = map.addListener('idle', () => {
                if (AR_DEBUG) console.log("Programmatic move (snap-back) finished. Resetting flag.");
                isProgrammaticMove = false;
                idleListener.remove(); 
            });
        }
    }
    // --- BARU: Fungsi Toggle Snap to Road ---
    function toggleSnapToRoad() {
        isSnapToRoadActive = !isSnapToRoadActive;
        console.log("Status Snap to Road:", isSnapToRoadActive);

        if (isSnapToRoadActive) {
            snapToRoadBtn.classList.remove('bg-gray-500');
            snapToRoadBtn.classList.add('bg-blue-500');
            snapToRoadBtn.setAttribute('title', 'Snap to Road (Aktif)');
        } else {
            snapToRoadBtn.classList.remove('bg-blue-500');
            snapToRoadBtn.classList.add('bg-gray-500');
            snapToRoadBtn.setAttribute('title', 'Snap to Road (Nonaktif)');
        }
        
        // Paksa update lokasi segera agar efeknya langsung terasa
        if (userPosition) {
            // Panggil update manual dengan posisi terakhir (hacky but works)
            updateUserLocation({ coords: { latitude: userPosition.lat(), longitude: userPosition.lng() } });
        }
    }

    function cancelNavigationMode() { 
        isNavigating = false;
        wasNavigating = false;
        clearTimeout(snapBackTimer);
        clearNavigationSpheres();
        currentRouteLine = null;
        snapBackTimer = null;
        isSnapToRoadActive = false;
        snapToRoadBtn.classList.remove('bg-blue-500');
        snapToRoadBtn.classList.add('bg-gray-500');
        snapToRoadBtn.style.display = 'none';
        setARButtonEnabled(false);
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
            if (AR_DEBUG) console.log("Ignoring programmatic move...");
            return; 
        }
        clearTimeout(snapBackTimer);
        if (isNavigating) {
            if (AR_DEBUG) console.log('User interrupted navigation.');
            isNavigating = false;
            wasNavigating = true; 
        }
        // if (cancelNavButton.style.display === 'flex') {
        //      cancelNavButton.style.display = 'none';
        // }
    }
    function startSnapBackTimer() { 
        if (isProgrammaticMove) {
            return;
        }
        clearTimeout(snapBackTimer);
        if (wasNavigating && directionsRenderer.getDirections()?.routes.length > 0) {
            if (AR_DEBUG) console.log('User stopped. Starting 4-second snap-back timer...');
            cancelNavButton.style.display = 'flex';
            snapToRoadBtn.style.display = 'flex';
            snapBackTimer = setTimeout(() => {
                if (AR_DEBUG) console.log('Timer finished. Snapping back to navigation.');
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
        // Hanya tampilkan navbar jika kita TIDAK sedang dalam mode AR/mini-map
        if (bottomNavbar && arContainer.style.display !== 'block') {
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


    // --- 7. FUNGSI PERGANTIAN MODE ---
    
        // =========================
    // === AR NAVIGATION (WebXR)
    // =========================

    let arInitialized = false;
    let arSession = null;
    let arRenderer, arScene, arCamera, arReticle;
    let arHitTestSource = null;
    let arLocalSpace = null;
    let arSurfaceDetected = false;
    let arNavSpheres = [];

    const arScanningText = document.getElementById('ar-scanning-text');

    // rute sederhana (contoh dari index.html)
    // arRoute sekarang hanya dipakai untuk jarak bola (bukan arah)
    const arRoute = [
        { distance: 5 }   // mis: 5 meter ke depan
    ];
    let arCurrentStep = 0;
    let arTargetHeading = 0;          // akan diisi dari rute
    // const AR_ANGLE_THRESHOLD = 5;   // boleh ±45°
    // const AR_HYSTERESIS_ANGLE = 90;  // jarak sebelum dianggap "lari jauh"
    // const LOST_FRAMES_THRESHOLD = 9999; // praktis: tidak auto-hapus
    // let arSphereSpawned = false;
    // let arSphereTravelled = false;
    // let arLostHeadingFrames = 0;
    // const HORIZONTAL_ANGLE_THRESHOLD = 25;

    const AR_DEBUG = true; // set false in production

    const AR_ANGLE_THRESHOLD = 10;    // toleransi ±35° untuk trigger spawn (atur 30-45 saat tuning)
    const AR_HYSTERESIS_ANGLE = 90;
    const LOST_FRAMES_THRESHOLD = 9999; // tidak auto-hapus (saat ini)
    let arSphereSpawned = false;
    let arSphereTravelled = false;
    let arLostHeadingFrames = 0;

    // Ground detection threshold & smoothing untuk angleDeg
    const HORIZONTAL_ANGLE_THRESHOLD = 25; // <=25° dianggap horizontal
    let smoothedPlaneAngle = null;
    const planeSmoothingFactor = 0.2; // 0..1, lebih besar = lebih responsif


    // GUIDANCE config
    const SPHERE_SPACING = 1.0;           // meter antar bola
    const SPHERE_COUNT_MAX = 20;         // limit maksimum bola yang di-spawn
    const TURN_ANGLE_THRESHOLD = 30;     // derajat perubahan heading untuk deteksi belokan
    const AR_ARROW_SPAWN_DISTANCE = 6.0; // spawn arrow ketika jarak ke belokan <= 6m (sesuaikan)
    const AR_ARROW_MODEL_URL = 'https://raw.githubusercontent.com/C-C-Studio/ARMapUMS/main/assets/3DModel/direction_arrow.glb?raw=1';

    // ---- STATE untuk spawn bertahap ----
    let sphereBufferPositions = []; // array THREE.Vector3 (world positions) yang siap di-spawn
    let sphereBufferPrepared = false;
    const MAX_BUFFER_SPHERES = 5;   // hanya siapkan 5 bola
    const BUFFER_SPHERE_SPACING = 1.0; // 1 meter antar bola (sesuai permintaan)
    const SPAWN_TRIGGER_DISTANCE = 0.8; // meter: user harus maju ~0.8m untuk spawn bola berikutnya
    const HEADING_CHECK_INTERVAL = 2000; // ms: cek kompas tiap 2 detik

    let lastHeadingCheckTime = 0;   // ms timestamp terakhir pengecekan arah
    let headingAligned = false;     // hasil cek arah terakhir

    let lastUserPosForSpawn = null; // {lat, lng} posisi user saat terakhir spawn bola


    // route parsed data
    let routePoints = [];      // [{lat, lng}] sampled from directions
    let routeDistances = [];   // cumulative distance along route (meters)
    let routeBearings = [];    // bearing of each segment (degrees)
    let turnPoints = [];       // indices or distances where turn happens [{index, distance, bearing, turnAngle}]

    const gltfLoader = new GLTFLoader();
    let arrowGltfScene = null;
    let arrowModelLoaded = false;

    function loadArrowModel() {
        if (arrowModelLoaded) return Promise.resolve(arrowGltfScene.clone());
        return new Promise((resolve, reject) => {
            gltfLoader.load(AR_ARROW_MODEL_URL, (gltf) => {
                arrowGltfScene = gltf.scene;
                arrowModelLoaded = true;
                resolve(arrowGltfScene.clone());
            }, undefined, (err) => {
                console.error('Failed load arrow GLB', err);
                reject(err);
            });
        });
    }
 


    function shortestAngleDiff(a, b) {
        let diff = a - b;
        diff = ((diff + 180) % 360) - 180;
        return Math.abs(diff);
    }


    // Hitung bearing (derajat) dari satu titik ke titik lain
    function computeBearing(fromLatLng, toLatLng) {
        if (!fromLatLng || !toLatLng) return null;

        // support google.maps.LatLng (with .lat()/.lng()) and LatLngLiteral {lat, lng}
        const latA = (typeof fromLatLng.lat === 'function') ? fromLatLng.lat() : fromLatLng.lat;
        const lonA = (typeof fromLatLng.lng === 'function') ? fromLatLng.lng() : fromLatLng.lng;
        const latB = (typeof toLatLng.lat === 'function') ? toLatLng.lat() : toLatLng.lat;
        const lonB = (typeof toLatLng.lng === 'function') ? toLatLng.lng() : toLatLng.lng;

        if (latA == null || lonA == null || latB == null || lonB == null) return null;

        const lat1 = latA * Math.PI / 180;
        const lon1 = lonA * Math.PI / 180;
        const lat2 = latB * Math.PI / 180;
        const lon2 = lonB * Math.PI / 180;

        const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
        const x =
            Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

        const brng = Math.atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    }


    // Ambil heading navigasi saat ini dari rute (arah dari posisi user ke tujuan)
    function getNavHeadingFromRoute() {
        const dir = directionsRenderer.getDirections();
        if (!dir || !dir.routes || !dir.routes.length) return null;

        const route = dir.routes[0];
        const leg = route.legs && route.legs[0];
        if (!leg) return null;

        // kalau GPS belum sempat update, pakai titik start rute dulu
        const from = userPosition || leg.start_location;
        const dest = leg.end_location;

        return computeBearing(from, dest);
    }


    function initARRenderer() {
        if (arInitialized) return;
        arInitialized = true;

        arRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        arRenderer.xr.enabled = true;

        const rect = arContainer.getBoundingClientRect();
        arRenderer.setSize(rect.width, rect.height);

        arScene = new THREE.Scene();
        arCamera = new THREE.PerspectiveCamera(70, rect.width / rect.height, 0.01, 20);
        arScene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
        arScene.add(arCamera);

        const ringGeo = new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2);

        // dua material: hijau = valid ground, merah = invalid
        const ringMatValid = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const ringMatInvalid = new THREE.MeshBasicMaterial({ color: 0xff4444 });

        arReticle = new THREE.Mesh(ringGeo, ringMatInvalid); // default merah (invalid)
        arReticle.matrixAutoUpdate = false;
        arReticle.visible = false;
        arScene.add(arReticle);

        // simpan referensi material agar mudah diganti saat deteksi
        arReticle._matValid = ringMatValid;
        arReticle._matInvalid = ringMatInvalid;


        arContainer.appendChild(arRenderer.domElement);

        window.addEventListener("resize", () => {
            const r = arContainer.getBoundingClientRect();
            arCamera.aspect = r.width / r.height;
            arCamera.updateProjectionMatrix();
            arRenderer.setSize(r.width, r.height);
        });
    }

    async function startARSession() {
        if (!navigator.xr) {
            alert("WebXR tidak didukung di perangkat ini.");
            return;
        }
        if (arSession) return;

        initARRenderer();

        try {
            const session = await navigator.xr.requestSession("immersive-ar", {
                requiredFeatures: ["hit-test", "dom-overlay"],
                domOverlay: { root: arContainer }   // 👈 AR overlay hanya di dalam container atas
            });

            arSession = session;
            arRenderer.xr.setReferenceSpaceType("local");
            await arRenderer.xr.setSession(session);

            const refSpace = await session.requestReferenceSpace("local");
            const viewerSpace = await session.requestReferenceSpace("viewer");
            arLocalSpace = refSpace;
            arHitTestSource = await session.requestHitTestSource({ space: viewerSpace });

            arSurfaceDetected = false;
            if (arScanningText) {
                arScanningText.style.display = 'flex';
            }

            session.addEventListener("end", () => {
                arSession = null;
                arHitTestSource = null;
                arLocalSpace = null;
                arSurfaceDetected = false;
                if (arScanningText) arScanningText.style.display = 'none';
                arRenderer.setAnimationLoop(null);
            });

            arRenderer.setAnimationLoop(onARFrame);
        } catch (e) {
            console.error(e);
            alert("Gagal memulai AR: " + e.message);
        }
    }

    function stopARSession() {
        if (arSession) {
            arSession.end();
        }
    }

    function addNavigationSpheres(originPose) {
        // kalau index di luar jangkauan, jangan lakukan apa-apa
        if (!originPose || arCurrentStep < 0 || arCurrentStep >= arRoute.length) return;

        const stepDistance = 1.0;
        const totalDistance = arRoute[arCurrentStep].distance;
        const numSpheres = Math.floor(totalDistance / stepDistance);

        // matrix pose dari hit-test (reticle)
        const mat = new THREE.Matrix4().fromArray(originPose.transform.matrix);

        // blink params
        const blinkSpeed = 3.0; // frekuensi kedip (Hz) - tweak jika perlu
        for (let i = 1; i <= numSpheres; i++) {
            const distance = i * stepDistance;

            // posisi lokal: tepat di depan kamera (arah -Z)
            const localPos = new THREE.Vector3(0, 0, -distance);
            const worldPos = localPos.clone().applyMatrix4(mat);

            const sphereGeo = new THREE.SphereGeometry(0.12, 16, 16);

            // material yang mendukung opacity untuk blink
            const sphereMat = new THREE.MeshBasicMaterial({
                color: 0x00aaff,
                transparent: true,
                opacity: 1.0, // initial, akan di-animate
                depthTest: true,
                depthWrite: false
            });

            const sphere = new THREE.Mesh(sphereGeo, sphereMat);

            // set posisi
            sphere.position.copy(worldPos);

            // simpan userData untuk animasi (phase/offset supaya blinking tidak sinkron)
            sphere.userData.blinkOffset = (i % 2 === 0) ? Math.PI : 0; // bergantian: even/odd phase
            sphere.userData.blinkSpeed = blinkSpeed;

            arScene.add(sphere);
            arNavSpheres.push(sphere);
        }
    }

    // --- Siapkan buffer posisi bola di depan pengguna sampai distanceMeters (max MAX_BUFFER_SPHERES) ---
    // Tidak langsung menambahkan mesh, hanya menghitung world positions berdasarkan pose
    function prepareSphereBuffer(originPose, distanceMeters) {
        sphereBufferPositions = [];
        sphereBufferPrepared = false;

        if (!originPose || distanceMeters <= 0) return;

        // hitung jumlah bola maksimal sesuai jarak dan batas buffer
        const count = Math.min(Math.floor(distanceMeters / BUFFER_SPHERE_SPACING), MAX_BUFFER_SPHERES);
        if (count <= 0) return;

        const mat = new THREE.Matrix4().fromArray(originPose.transform.matrix);

        for (let i = 1; i <= count; i++) {
            const d = i * BUFFER_SPHERE_SPACING;
            const localPos = new THREE.Vector3(0, 0, -d);
            const worldPos = localPos.clone().applyMatrix4(mat);
            sphereBufferPositions.push(worldPos);
        }

        sphereBufferPrepared = true;
    }

    // --- Spawn 1 bola berikutnya dari buffer ---
    // Mengembalikan true jika berhasil spawn, false jika tidak ada buffer
    function spawnNextBufferedSphere() {
        if (!sphereBufferPrepared || !sphereBufferPositions.length) return false;

        const worldPos = sphereBufferPositions.shift();
        // buat mesh sphere seperti sebelumnya
        const sphereGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 1.0, depthTest: true, depthWrite: false });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(worldPos);

        // animasi blink
        sphere.userData.blinkOffset = (Math.random() > 0.5) ? Math.PI : 0;
        sphere.userData.blinkSpeed = 2.5;

        arScene.add(sphere);
        arNavSpheres.push(sphere);

        // update lastUserPosForSpawn supaya next spawn butuh jarak lagi
        if (userPosition) {
            lastUserPosForSpawn = { lat: userPosition.lat(), lng: userPosition.lng() };
        } else {
            lastUserPosForSpawn = null;
        }

        // kalau buffer kosong set prepared false sehingga nanti perlu prepare ulang
        if (!sphereBufferPositions.length) sphereBufferPrepared = false;

        return true;
    }


    // spawn arrow model in front at distanceMeters, rotated to show left/right/straight
    async function spawnTurnArrow(originPose, turn) {
        try {
            const arrow = await loadArrowModel();
            // arrow is a Scene/group clone already returned by loader
            const arrowRoot = arrow;
            arrowRoot.userData = arrowRoot.userData || {};
            arrowRoot.userData.isTurnArrow = true;
            arrowRoot.userData.turnIndex = turn.index;

            // compute position in front
            const mat = new THREE.Matrix4().fromArray(originPose.transform.matrix);
            const localPos = new THREE.Vector3(0, 0, -Math.min(AR_ARROW_SPAWN_DISTANCE, Math.max(2, turn.distance || AR_ARROW_SPAWN_DISTANCE)));
            const worldPos = localPos.clone().applyMatrix4(mat);

            arrowRoot.position.copy(worldPos);
            arrowRoot.position.y += 0.05; // sedikit angkat supaya tidak clipping

            // --- Orientasi arrow: lebih robust menggunakan lookAt ke world direction dari turn.bearing ---
            // compute world direction vector for turnBearing (heading -> world dir)
            const headingRad = (turn.bearing) * Math.PI / 180;
            const dirVec = new THREE.Vector3(Math.sin(headingRad), 0, -Math.cos(headingRad));
            const lookTarget = arrowRoot.position.clone().add(dirVec);
            arrowRoot.lookAt(lookTarget);

            // adjust scale / orientation if model axes mismatch
            arrowRoot.scale.set(0.7, 0.7, 0.7);

            // finally add to scene and list ONCE
            arScene.add(arrowRoot);
            arNavSpheres.push(arrowRoot);

            if (AR_DEBUG) console.log('spawnTurnArrow: spawned arrow for turn', turn.index);
        } catch (e) {
            console.warn('spawnTurnArrow failed', e);
        }
    }


    function disposeObject(obj) {
        if (!obj) return;
        // dispose recursively children first
        if (obj.children && obj.children.length) {
            obj.children.forEach(child => disposeObject(child));
        }
        if (obj.geometry) {
            try { obj.geometry.dispose(); } catch (e) {}
        }
        if (obj.material) {
            try {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => { if (m && m.dispose) m.dispose(); });
                } else {
                    if (obj.material.dispose) obj.material.dispose();
                }
            } catch (e) {}
        }
    }

    function clearNavigationSpheres() {
        arNavSpheres.forEach(s => {
            try {
                disposeObject(s);
                arScene.remove(s);
            } catch (e) {
                console.warn('Error disposing sphere', e);
            }
        });
        arNavSpheres = [];

        // reset buffer state
        sphereBufferPositions = [];
        sphereBufferPrepared = false;
        lastUserPosForSpawn = null;
        arSphereSpawned = false;
    }




    function onARFrame(time, frame) {
        const session = arRenderer.xr.getSession();
        if (!session) return;

        if (frame && arHitTestSource && arLocalSpace) {
            const hitTestResults = frame.getHitTestResults(arHitTestSource);
            if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(arLocalSpace);

            // --- EXTRACT ROTATION & COMPUTE NORMAL (Three.js) ---
            const poseMat = new THREE.Matrix4().fromArray(pose.transform.matrix);
            const rotMat = new THREE.Matrix4().extractRotation(poseMat);

            // normal permukaan menurut pose (transform vektor "up" lokal)
            const normal = new THREE.Vector3(0, 1, 0).applyMatrix4(rotMat).normalize();
            const worldUp = new THREE.Vector3(0, 1, 0);

            // sudut (radian -> derajat) antara normal dan worldUp
            const angleDeg = normal.angleTo(worldUp) * 180 / Math.PI;

            // debug: tampilkan angle di console (hapus/comment jika tidak perlu)
            // smoothing kecil agar angleDeg tidak melompat-lompat
            if (smoothedPlaneAngle === null) smoothedPlaneAngle = angleDeg;
            else smoothedPlaneAngle = smoothedPlaneAngle * (1 - planeSmoothingFactor) + angleDeg * planeSmoothingFactor;

            const displayAngle = smoothedPlaneAngle;
            const isGroundPlane = displayAngle <= HORIZONTAL_ANGLE_THRESHOLD;

            // debug terpusat
            console.log({
            planeRaw: angleDeg.toFixed(1),
            planeSmoothed: displayAngle.toFixed(1),
            isGroundPlane
            });

            // update reticle: pos & warna / visibilitas sesuai validitas
            if (isGroundPlane) {
                arReticle.visible = true;
                arReticle.material = arReticle._matValid; // hijau
                arReticle.matrix.fromArray(pose.transform.matrix);

                if (!arSurfaceDetected) {
                    arSurfaceDetected = true;
                    if (arScanningText) arScanningText.style.display = 'none';
                }
            } else {
                // plane bukan ground (mungkin dinding) -> reticle merah atau sembunyikan
                // jika mau tunjukkan reticle merah, uncomment baris di bawah; 
                // untuk UX lebih aman, kita sembunyikan reticle
                arReticle.visible = false;
                // arReticle.visible = true;
                // arReticle.material = arReticle._matInvalid;
                // arReticle.matrix.fromArray(pose.transform.matrix);
                
                if (arSurfaceDetected) {
                    arSurfaceDetected = false;
                    if (arScanningText) arScanningText.style.display = 'flex';
                }
            }

                // logika spawn bola ketika heading cocok
                // === LOGIKA SPAWN BOLA BERDASARKAN ARAH NAVIGASI ===

                // kalau belum mode navigasi, jangan tampilkan bola
                // === LOGIKA SPAWN BOLA BERDASARKAN ARAH NAVIGASI ===

                // cek dulu: ada rute aktif atau tidak
                const dir = directionsRenderer.getDirections();
                const hasRoute = !!(dir && dir.routes && dir.routes.length);

                // kalau tidak ada rute sama sekali → jangan main bola
                if (!hasRoute) {
                    clearNavigationSpheres();
                    arSphereSpawned = false;
                    arSphereTravelled = false;
                    arLostHeadingFrames = 0;
                } else {

                    // DEBUG (sementara, boleh dihapus nanti)
                    // console.log('AR headingNow =', headingNow, 'navHeading =', navHeading);

                    // sebelum spawn, pastikan reticle valid & ground
                    if (isGroundPlane && arReticle.visible) {
                        // determine distance from user along route to next turn
                        function distanceAlongRouteFromUser() {
                            if (!routePoints.length || !userPosition) return null;
                            // find nearest route point index to userPosition
                            let nearestIdx = 0;
                            let nearestDist = Infinity;
                            for (let i = 0; i < routePoints.length; i++) {
                                const p = routePoints[i];
                                const d = haversineDistance(userPosition.lat(), userPosition.lng(), p.lat, p.lng);
                                if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
                            }
                            // compute distance from nearestIdx to next turn
                            const userCumDist = (routeDistances[nearestIdx] || 0);
                            let nextTurn = null;
                            for (const t of turnPoints) {
                                if (t.distance > userCumDist) { nextTurn = t; break; }
                            }
                            if (!nextTurn) return { nextTurn: null, distToNextTurn: null };
                            const distToNextTurn = nextTurn.distance - userCumDist;
                            return { nextTurn, distToNextTurn };
                        }

                        // --- LOGIKA SPAWN BERTAHAP: cek heading periodik lalu spawn 1-per-1 saat user maju ---
                        const nowMs = (typeof time === 'number') ? time : performance.now();

                        // heading pengguna & heading rute
                        const headingNow = (window.__UMS_AR_HEADING ?? arHeading ?? null);
                        const navHeading = getNavHeadingFromRoute();

                        if (headingNow != null && navHeading != null) {
                            arTargetHeading = navHeading;
                            const angDiff = shortestAngleDiff(headingNow, arTargetHeading);

                            // periodic heading check (hemat resource): setiap HEADING_CHECK_INTERVAL ms
                            if (nowMs - lastHeadingCheckTime >= HEADING_CHECK_INTERVAL) {
                                headingAligned = (angDiff <= AR_ANGLE_THRESHOLD);
                                lastHeadingCheckTime = nowMs;
                                if (AR_DEBUG) console.log('Heading check:', { angDiff: angDiff.toFixed(1), headingAligned });
                            }

                            // jika ada rute, hitung jarak ke belokan berikutnya
                            const routeInfo = (typeof distanceAlongRouteFromUser === 'function') ? distanceAlongRouteFromUser() : null;
                            const distToNextTurn = routeInfo ? routeInfo.distToNextTurn : null;
                            const nextTurn = routeInfo ? routeInfo.nextTurn : null;

                            // tentukan jarak total yang ingin kita pandu (spawn buffer), sampai next turn atau default
                            let intendedGuidanceDist = distToNextTurn != null ? Math.min(distToNextTurn, SPHERE_COUNT_MAX * SPHERE_SPACING) : Math.min(SPHERE_COUNT_MAX * SPHERE_SPACING, 10);

                            // gunakan hanya MAX_BUFFER_SPHERES (5) dan spacing BUFFER_SPHERE_SPACING
                            intendedGuidanceDist = Math.min(intendedGuidanceDist, MAX_BUFFER_SPHERES * BUFFER_SPHERE_SPACING);

                            // Jika heading sesuai dan belum ada buffer dipersiapkan → prepare buffer & spawn 1 bola pertama
                            if (headingAligned && !sphereBufferPrepared) {
                                // bersihkan bola sebelumnya & prepare baru (jika ada)
                                clearNavigationSpheres();
                                prepareSphereBuffer(pose, intendedGuidanceDist);

                                // spawn pertama langsung agar user mendapat tanda
                                if (sphereBufferPrepared) {
                                    spawnNextBufferedSphere();
                                    arSphereSpawned = true;
                                    if (AR_DEBUG) console.log('Prepared buffer and spawned first sphere (buffer size)', sphereBufferPositions.length);
                                }
                            }

                            // jika buffer sudah dipersiapkan, spawn bola selanjutnya saat user sudah maju SPAWN_TRIGGER_DISTANCE
                            if (sphereBufferPrepared) {
                                // pastikan kita punya posisi user sebelumnya untuk perbandingan
                                if (lastUserPosForSpawn && userPosition) {
                                    const moved = haversineDistance(lastUserPosForSpawn.lat, lastUserPosForSpawn.lng, userPosition.lat(), userPosition.lng());
                                    if (moved >= SPAWN_TRIGGER_DISTANCE) {
                                        const ok = spawnNextBufferedSphere();
                                        if (ok && AR_DEBUG) console.log('Spawned next buffered sphere after user moved', moved.toFixed(2), 'm');
                                    }
                                } else {
                                    // jika belum ada reference lastUserPosForSpawn tapi buffer ada, set lastUserPosForSpawn sekarang
                                    if (userPosition && !lastUserPosForSpawn) {
                                        lastUserPosForSpawn = { lat: userPosition.lat(), lng: userPosition.lng() };
                                    }
                                }
                            }

                            // Spawn arrow when approaching turn (sama seperti sebelumnya)
                            if (nextTurn && distToNextTurn <= AR_ARROW_SPAWN_DISTANCE) {
                                const arrowAlready = arNavSpheres.some(s => s.userData && s.userData.isTurnArrow && s.userData.turnIndex === nextTurn.index);
                                if (!arrowAlready) {
                                    spawnTurnArrow(pose, nextTurn);
                                    if (AR_DEBUG) console.log('spawned arrow for turn', nextTurn);
                                }
                            }
                        } else {
                            // kalau heading belum tersedia -> jangan spawn
                            if (AR_DEBUG && !headingNow) console.log('spawn skip: headingNow null');
                            if (AR_DEBUG && !navHeading) console.log('spawn skip: navHeading null');
                        }


                    } else {
                        // opsional: log kenapa tidak spawn
                        if (!isGroundPlane) if (AR_DEBUG) console.log('spawn skip: plane bukan ground (angle > threshold)');
                        if (!arReticle.visible) if (AR_DEBUG) console.log('spawn skip: reticle tidak terlihat');
                    }

                }


                // === akhir logika spawn bola ===

            } else {
                arReticle.visible = false;
                if (arSurfaceDetected) {
                    arSurfaceDetected = false;
                    if (arScanningText) arScanningText.style.display = 'flex';
                }
            }
        }
        // ----------------------
        // Animasi blinking spheres
        // ----------------------
        try {
            // time dalam milidetik dari WebXR frame callback -> convert ke detik
            const tSec = (typeof time === 'number') ? (time / 1000) : performance.now() / 1000;

            // jika ada sphere, update opacity
            if (arNavSpheres && arNavSpheres.length > 0) {
                for (let i = 0; i < arNavSpheres.length; i++) {
                    const s = arNavSpheres[i];
                    if (!s || !s.material) continue;

                    const speed = s.userData.blinkSpeed || 2.5;
                    const offset = s.userData.blinkOffset || 0;
                    // sin wave antara 0..1
                    const alpha = 0.5 + 0.5 * Math.sin(tSec * Math.PI * 2 * speed + offset);
                    // optional: ramp minimum visibility (so it never fully disappears)
                    const minAlpha = 0.25;
                    s.material.opacity = Math.max(minAlpha, alpha);
                }
            }
        } catch (e) {
            console.warn('Blink update error', e);
        }

        arRenderer.render(arScene, arCamera);
    }




    async function switchToAR() {
        if (!isNavigating) {
        alert('Silakan pilih tujuan dan tekan tombol MULAI sebelum masuk mode AR.');
        return;
    }
        if (AR_DEBUG) console.log("Switching to AR Mode...");
        
        bottomNavbar.classList.add('translate-y-full');
        
        arContainer.style.display = 'block'; 
        arButton.style.display = 'none';
        closeArButton.style.display = 'block';
        locateButton.style.display = 'none';

        // tombol nav dipindah agak turun sedikit (opsional)
        startNavButton.classList.remove('bottom-52');
        cancelNavButton.classList.remove('bottom-52');
        startNavButton.classList.add('bottom-4');
        cancelNavButton.classList.add('bottom-4'); 

        // 🔥 inisialisasi mini map kalau belum ada
        if (!arMiniMap) {
            arMiniMap = new Map(arMapInner, {
                center: userPosition || defaultCenter,
                zoom: 17,
                disableDefaultUI: true,
                clickableIcons: false,
                mapId: map.getMapTypeId ? map.getMapTypeId() : undefined
            });

            arMiniDirectionsRenderer = new DirectionsRenderer({
                suppressMarkers: true,
                preserveViewport: true,
            });
            arMiniDirectionsRenderer.setMap(arMiniMap);

            // kalau rute sudah ada sebelumnya, langsung gambar juga
            const currentDir = directionsRenderer.getDirections();
            if (currentDir && currentDir.routes && currentDir.routes.length > 0) {
                arMiniDirectionsRenderer.setDirections(currentDir);
            }
        }

        // tampilkan popup map
        if (arMapOverlay) {
            arMapOverlay.style.display = 'block';
        }

        // mulai AR session
        await startARSession();
    }


    function switchToMap() {
        if (AR_DEBUG) console.log("Switching to Map Mode...");

        bottomNavbar.classList.remove('translate-y-full');

        arContainer.style.display = 'none';
        arButton.style.display = 'flex';
        closeArButton.style.display = 'none';
        locateButton.style.display = 'flex';

        startNavButton.classList.remove('bottom-4');
        cancelNavButton.classList.remove('bottom-4');
        startNavButton.classList.add('bottom-52');
        cancelNavButton.classList.add('bottom-52');

        // sembunyikan popup mini map
        if (arMapOverlay) {
            arMapOverlay.style.display = 'none';
        }

        // hentikan sesi AR
        stopARSession();
    }


    setARButtonEnabled(false);

    // --- 8. MULAI PELACAKAN LOKASI (PETA) SAAT AWAL DIMUAT ---
    startWatchingLocation();
    startMapOrientationListener();
}

initMap();