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
    
    // --- PERUBAHAN: Variabel untuk menyimpan data mentah kompas ---
    let lastCompassAlpha = 0; 
    let correctedHeading = 0;

    let correctedNeedleHeading = 0;

    let isNavigating = false;
    let wasNavigating = false;
    let snapBackTimer = null;
    let pendingDestination = null; 
    
    let isProgrammaticMove = false;

    const defaultCenter = new LatLng(-7.5567, 110.7711);
    const defaultZoom = 17;

    const locateButton = document.getElementById('locate-btn');
    const arButton = document.getElementById('ar-btn');
    const startNavButton = document.getElementById('start-nav-btn');
    const cancelNavButton = document.getElementById('cancel-nav-btn');

    const compassIndicator = document.getElementById('compass-indicator');
    const compassNeedle = document.getElementById('compass-needle');


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

    map.addListener('dragstart', interruptNavigation); 
    mapElement.addEventListener('wheel', interruptNavigation, { passive: true });
    
    map.addListener('idle', () => {
        if (wasNavigating) {
            startSnapBackTimer();
        }
    });

    // --- PERUBAHAN: Listener untuk Orientasi Device (Kompas) ---
    function handleOrientation(event) {
        // event.webkitCompassHeading untuk iOS (Safari)
        // event.alpha untuk standar (Android/Chrome)
        const alpha = event.webkitCompassHeading || event.alpha;
        if (alpha == null) return;
        
        lastCompassAlpha = alpha; // Simpan data mentah
        
        // Tampilkan UI Kompas jika ini panggilan pertama
        // Kita tidak lagi memutar jarum kompas di sini.
        if (compassIndicator && compassIndicator.style.display === 'none') {
            compassIndicator.style.display = 'flex';
        }
        
        updateCompassRotation(); // Panggil fungsi update rotasi kerucut
    }
    
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', handleOrientation, true);
    } else {
        console.warn("DeviceOrientationEvent (kompas) tidak didukung di browser ini.");
    }

    // --- BARU: Listener saat PETA DIPUTAR oleh user ---
    // Ini akan memicu perhitungan ulang rotasi kompas
    map.addListener('heading_changed', updateCompassRotation);


    // --- 5. FUNGSI LOGIKA INTI ---

    // --- BARU: Fungsi terpisah untuk menghitung & menerapkan rotasi ---
    function updateCompassRotation() {
        if (!userMarker) return; // Jangan lakukan apa-apa jika marker belum ada

        const mapHeading = map.getHeading() || 0; // Dapatkan putaran peta saat ini
        
        // --- 1. LOGIKA UNTUK KERUCUT (BEAM) ---
        // menggunakan -lastCompassAlpha untuk mengoreksi arah kerucut agar sesuai arah dunia nyata
        const targetConeHeading = -lastCompassAlpha - mapHeading;
        
        let coneDelta = targetConeHeading - correctedHeading;

        // Atasi "wrap-around" untuk kerucut
        if (coneDelta > 180) {
            coneDelta -= 360; 
        } else if (coneDelta < -180) {
            coneDelta += 360; 
        }
        
        correctedHeading += coneDelta;
        
        const headingEl = userMarker.content.querySelector('.user-location-heading');
        if (headingEl) {
            headingEl.style.transform = `translate(-50%, -50%) rotate(${correctedHeading}deg)`;
        }

        // --- 2. LOGIKA UNTUK JARUM KOMPAS (NEEDLE UI) ---
        // PERBAIKAN: Arah jarum adalah (Rotasi Kerucut + Rotasi Peta)
        // Ini mengubah arah kerucut di layar kembali ke arah dunia nyata.
        const targetNeedleHeading = correctedHeading + mapHeading;
        
        let needleDelta = targetNeedleHeading - correctedNeedleHeading;
        
        // Atasi "wrap-around" untuk jarum kompas
        if (needleDelta > 180) {
            needleDelta -= 360;
        } else if (needleDelta < -180) {
            needleDelta += 360;
        }

        correctedNeedleHeading += needleDelta;

        if (compassNeedle) {
            compassNeedle.style.transform = `rotate(${correctedNeedleHeading}deg)`;
        }
    }
    // --- AKHIR PENGGANTIAN ---


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

        // --- PERUBAHAN: Panggil fungsi update kompas ---
        // Ini akan mengatur rotasi awal saat marker pertama kali dibuat
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

    function buildUserMarker() {
        const markerEl = document.createElement('div');
        markerEl.className = 'user-location-marker';
        
        const headingEl = document.createElement('div');
        headingEl.className = 'user-location-heading';
        
        const dotEl = document.createElement('div');
        dotEl.className = 'user-location-dot';
        
        markerEl.appendChild(headingEl); // Beam/kerucut
        markerEl.appendChild(dotEl);     // Titik biru (di atas)
        
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

        locations.forEach(location => {
            const marker = new AdvancedMarkerElement({
                map: map,
                position: { lat: location.lat, lng: location.lon },
                title: location.nama,
            });

            marker.addListener('click', () => {
                if (!userPosition) {
                    alert('Silakan tekan tombol "Locate Me" terlebih dahulu untuk menentukan lokasi Anda.');
                    startWatchingLocation(); 
                    return;
                }

                const destination = new LatLng(location.lat, location.lon);
                pendingDestination = destination; 

                calculateAndDisplayRoute(userPosition, destination);
            });
        });

    } catch (error) {
        console.error("Gagal memuat atau mem-parsing location.json:", error);
    }

    // --- 7. MULAI PELACAKAN LOKASI SAAT PETA DIMUAT ---
    startWatchingLocation();
}

// Panggil fungsi inisialisasi utama
initMap();