// ===============================================
// Inisialisasi Peta MapLibre
// ===============================================
var latmap = -7.5567;
var lonmap = 110.7711;

const map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`,
    center: [lonmap, latmap], // [Lng, Lat]
    zoom: 16.5,
    pitch: 45,
    bearing: -17.6
});

// Variabel untuk menyimpan lokasi pengguna & status
var userLocation = null;
var isUserOnCampusFlag = false;
let pendingRouteDestination = null;

let activePopup = null; 
let isProgrammaticTrigger = false;

// Variabel Status Navigasi & Timer
let isNavigating = false; // Status apakah kita dalam mode navigasi
let wasNavigating = false; // Flag untuk melacak jika navigasi diinterupsi
let snapBackTimer = null; // Timer untuk 'snap back'

// BARU: Variabel untuk rute aktif (untuk Snap-to-Road)
let currentRouteLine = null;

let isSnapToRoadActive = false;

// BARU: Variabel Status Kompas
let lastCompassAlpha = 0;
let smoothedAlpha = null;
const smoothingFactor = 0.1;
let correctedNeedleHeading = 0; // Untuk smoothing jarum kompas
let userMarker = null;
let correctedConeHeading = 0; // Untuk smoothing kerucut marker

// Panel Search
const openSearchBtn = document.getElementById('open-search-btn');
const closeSearchBtn = document.getElementById('close-search-btn');
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const allLocationsList = document.getElementById('all-locations-list');
let allLocationsData = [];

// Tombol Start/Cancel Navigasi
const startNavBtn = document.getElementById('start-nav-btn');
const cancelNavBtn = document.getElementById('cancel-nav-btn');
const snapToRoadBtn = document.getElementById('snap-to-road-btn');

const locateButton = document.getElementById('locate-btn');

// Elemen Kompas Peta
const compassIndicator = document.getElementById('compass-indicator');
const compassNeedle = document.getElementById('compass-needle');
const degreeIndicator = document.getElementById('degree-indicator');

// Referensi Elemen AR
const arButton = document.getElementById('ar-btn'); 
const arContainer = document.getElementById('ar-container')
const closeArButton = document.getElementById('close-ar-btn');

// Fungsi createLocationListItem (Tidak berubah)
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

// --- BARU: Fungsi untuk membuat marker pengguna kustom ---
function buildUserMarker() {
    const markerEl = document.createElement('div');
    markerEl.className = 'user-location-marker';
    const headingEl = document.createElement('div');
    headingEl.className = 'user-location-heading'; // Ini kerucutnya
    const dotEl = document.createElement('div');
    dotEl.className = 'user-location-dot';
    markerEl.appendChild(headingEl);
    markerEl.appendChild(dotEl);     
    return markerEl;
}

// ===============================================
// Logika Memuat Data (Marker & Jalur)
// ===============================================
map.on('load', () => {
    // 1. Muat Lokasi (Marker)
    fetch('assets/data/location.json')
        .then(response => response.json())
        .then(data => {
            console.log("Data lokasi berhasil dimuat:", data);
            allLocationsData = data;
            allLocationsList.innerHTML = '';
            
            data.forEach(lokasi => {
                const popup = new maplibregl.Popup({ offset: 25, closeButton: false, className: 'custom-popup' })
                    .setHTML(`
                        <div class="bg-white rounded-lg shadow-md p-3 max-w-xs">
                            <h3 class="font-bold text-gray-900">${lokasi.nama}</h3>
                            <p class="text-sm text-gray-600">${lokasi.deskripsi}</p>
                            <button class="route-btn-popup w-full mt-2 bg-blue-500 text-white text-sm font-semibold py-1 px-3 rounded" data-lat="${lokasi.lat}" data-lon="${lokasi.lon}" data-nama="${lokasi.nama}">
                                <i class="fas fa-route mr-1"></i> Rute ke sini
                            </button>
                        </div>
                    `);

                const marker = new maplibregl.Marker({
                        color: "#DC2626",
                    })
                    .setLngLat([lokasi.lon, lokasi.lat])
                    .setPopup(popup)
                    .addTo(map);

                popup.on('open', () => {
                    activePopup = popup;
                });
                popup.on('close', () => {
                    if (activePopup === popup) {
                        activePopup = null;
                    }
                });

                const listItem = createLocationListItem(lokasi);
                allLocationsList.appendChild(listItem);
            });
        })
        .catch(error => console.error('Error memuat data lokasi:', error));

    // 2. Muat Jalur Kustom (GeoJSON)
    fetch('assets/data/path.json')
        .then(response => response.json())
        .then(data => {
            console.log("Data jalur berhasil dimuat:", data);
            
            const geojsonData = {
                type: 'FeatureCollection',
                features: data.map(jalur => ({
                    type: 'Feature',
                    properties: {
                        nama: jalur.nama
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: jalur.coordinates.map(coord => [coord[1], coord[0]]) // Balik [lat, lon] -> [lon, lat]
                    }
                }))
            };

            map.addSource('custom-paths', {
                type: 'geojson',
                data: geojsonData
            });

            map.addLayer({
                id: 'custom-paths-layer',
                type: 'line',
                source: 'custom-paths',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#fff34c', 
                    'line-width': 5,
                    'line-opacity': 1
                }
            });

            map.on('click', 'custom-paths-layer', (e) => {
                const nama = e.features[0].properties.nama;
                new maplibregl.Popup()
                    .setLngLat(e.lngLat)
                    .setHTML(`<b class="text-black">${nama}</b>`)
                    .addTo(map);
            });
        })
        .catch(error => console.error('Error memuat data jalur:', error));
        
    // ===============================================
    // BARU: Mulai Listener Kompas & Rotasi Peta
    // ===============================================
    startMapOrientationListener();
    map.on('rotate', updateCompassRotation);
});

// ===============================================
// Fungsi untuk membuat rute (Tidak berubah)
// ===============================================
async function createRoute(destLat, destLon, destName) {
    clearTimeout(snapBackTimer); 
    snapBackTimer = null;
    isNavigating = false;     
    wasNavigating = false;  
    if (!isUserOnCampusFlag) {
        alert("Fitur rute hanya dapat digunakan saat Anda berada di area kampus UMS.");
        return;
    }
    if (!userLocation) {
        alert("Lokasi Anda belum ditemukan. Silakan aktifkan lokasi Anda.");
        return;
    }

    const startLng = userLocation[0];
    const startLat = userLocation[1];

    if (map.getLayer('route')) {
        map.removeLayer('route');
    }
    if (map.getSource('route')) {
        map.removeSource('route');
    }
    
    startNavBtn.style.display = 'none';
    cancelNavBtn.style.display = 'none';

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
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: routeGeoJSON
                }
            });

            map.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#3887be',
                    'line-width': 7,
                    'line-opacity': 0.8
                }
            });

            currentRouteLine = routeGeoJSON;

            const coordinates = routeGeoJSON.coordinates;
            const bounds = coordinates.reduce((bounds, coord) => {
                return bounds.extend(coord);
            }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

            map.fitBounds(bounds, {
                padding: 40 
            });

            startNavBtn.style.display = 'flex';

        } else {
            alert("Tidak dapat menemukan rute.");
        }
    } catch (error) {
        console.error('Error fetching route:', error);
        alert("Terjadi kesalahan saat mengambil rute.");
    }
}

// ===============================================
// Logika handleRouteRequest (Tidak berubah)
// ===============================================
function handleRouteRequest(lat, lon, nama) {
    console.log("Permintaan rute diterima. Memperbarui lokasi pengguna...");
    pendingRouteDestination = { lat: lat, lon: lon, nama: nama };
    
    if (userLocation) {
        console.log("Lokasi sudah ada. Langsung buat rute.");
        createRoute(lat, lon, nama);
        pendingRouteDestination = null; 
    } else {
        console.log("Lokasi belum ada. Memicu geolocate...");
        isProgrammaticTrigger = true;
        geolocate.trigger(); 
    }
}

// ===============================================
// Logika Lokasi Pengguna
// ===============================================
const geolocate = new maplibregl.GeolocateControl({
    positionOptions: {
        enableHighAccuracy: true
    },
    trackUserLocation: true,
    showUserLocation: false,
    showUserHeading: true
});

map.addControl(geolocate, 'bottom-left');

geolocate.on('geolocate', onLocationFound);
geolocate.on('error', onLocationError);

geolocate.on('trackuserlocationstart', () => {
     if (isProgrammaticTrigger) {
        isProgrammaticTrigger = false; 
    } else {
        console.log("Pencarian lokasi manual, rute tertunda dibatalkan.");
        pendingRouteDestination = null;
    }
});

function onLocationFound(e) {
    const userLng = e.coords.longitude;
    const userLat = e.coords.latitude;
    
    // Simpan lokasi GPS MENTAH
    const rawUserLocation = [userLng, userLat];
    
    // Tentukan lokasi final untuk marker
    let finalLocation;

    // --- Logika Snap-to-Road ---
    if ((isNavigating || wasNavigating) && currentRouteLine && isSnapToRoadActive) {
        // 1. Buat 'Point' Turf dari lokasi mentah
        const userPoint = turf.point(rawUserLocation);
        // 2. Temukan titik terdekat PADA GARIS RUTE
        const snappedResult = turf.pointOnLine(currentRouteLine, userPoint);
        // 3. Ambil koordinat [lng, lat] dari hasil
        finalLocation = snappedResult.geometry.coordinates;
    } else {
        // Jika tidak navigasi, gunakan lokasi mentah
        finalLocation = rawUserLocation;
    }

    // Gunakan 'finalLocation' untuk semua hal di bawah ini
    userLocation = finalLocation; // Update variabel global

    if (!userMarker) {
        const markerEl = buildUserMarker();
        userMarker = new maplibregl.Marker({element: markerEl, anchor: 'center'})
            .setLngLat(userLocation) // <-- Gunakan 'userLocation' (yang sudah di-snap)
            .addTo(map);
    } else {
        userMarker.setLngLat(userLocation); // <-- Gunakan 'userLocation' (yang sudah di-snap)
    }

    if (isNavigating && !wasNavigating) {
        map.easeTo({
            center: userLocation,
            bearing: lastCompassAlpha || 0, // Arahkan sesuai heading perangkat
            duration: 1000, // Durasi animasi (sesuaikan dengan interval GPS, biasanya 1 detik)
            easing: n => n, // Linear easing agar pergerakan halus
            pitch: 60      // Pertahankan kemiringan kamera
        });
    }
    
    const userLngLat = new maplibregl.LngLat(userLocation[0], userLocation[1]);

    if (isUserOnCampus(userLngLat)) {
        isUserOnCampusFlag = true;
        console.log("Status: Pengguna terdeteksi DI DALAM area kampus.");
    } else {
        isUserOnCampusFlag = false;
        console.log("Status: Pengguna terdeteksi DI LUAR area kampus.");
        if (!pendingRouteDestination) {
            alert("Anda terdeteksi berada di luar area kampus. Fitur rute tidak akan tersedia.");
        }
    }

    if (pendingRouteDestination) {
        console.log("Lokasi ditemukan, mencoba membuat rute yang tertunda...");
        createRoute(
            pendingRouteDestination.lat,
            pendingRouteDestination.lon,
            pendingRouteDestination.nama
        );
        pendingRouteDestination = null;
    }
}

function onLocationError(e) {
     alert("Tidak bisa mendapatkan lokasi Anda. Pastikan GPS dan izin lokasi aktif.");
    pendingRouteDestination = null;
}

// ===============================================
// Logika Auto-Hide Navbar (Tidak berubah)
// ===============================================
const bottomNavbar = document.getElementById('bottom-navbar');
let hideControlsTimer = null;
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
map.on('movestart', hideMapControls);
map.on('moveend', function() {
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(showMapControls, 2000);
});

// ===============================================
// Logika Panel Search (Tidak berubah)
// ===============================================
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

    const locationBtn = e.target.closest('.location-btn');
    
    if (locationBtn) {
        map.flyTo({
            center: [item.dataset.lon, item.dataset.lat],
            zoom: 18
        });
    } else {
        handleRouteRequest(item.dataset.lat, item.dataset.lon, item.dataset.nama);
    }
    searchPanel.classList.add('-translate-y-full');
});


// ===============================================
// Listener untuk popup (Tidak berubah)
// ===============================================
document.getElementById('map').addEventListener('click', function(e) {
     if (e.target.matches('.route-btn-popup, .route-btn-popup *')) {
        const button = e.target.closest('.route-btn-popup');
        const lat = button.dataset.lat;
        const lon = button.dataset.lon;
        const nama = button.dataset.nama;
        
        handleRouteRequest(lat, lon, nama); 
        
        if (activePopup) {
            activePopup.remove();
            activePopup = null; 
        }
    }
});

// Logika filter pencarian (Tidak berubah)
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


// ===============================================
// Fungsi untuk Masuk ke Mode Navigasi (Tidak berubah)
// ===============================================
function startNavigationMode() {
    // 1. Set status & Sembunyikan/Tampilkan tombol
    isNavigating = true;
    wasNavigating = false; 
    startNavBtn.style.display = 'none';
    cancelNavBtn.style.display = 'flex';
    snapToRoadBtn.style.display = 'flex';
    
    // 2. Pastikan kita punya lokasi pengguna
    if (userLocation) {
        // 3. Miringkan, Zoom, DAN PUSATKAN ke pengguna
        map.easeTo({
            center: userLocation,
            pitch: 60,
            zoom: 19,
            duration: 1000
        });

        // 4. Paksa 'GeolocateControl' ke mode "Follow & Heading"
        if (geolocate._controlButton) {
            // _watchState: 0 = OFF, 2 = ACTIVE_LOCK (follow), 3 = ACTIVE_HEADING (follow+heading)
            if (geolocate._watchState === 2) { 
                 geolocate._controlButton.click(); // Pindahkan dari 2 ke 3
            } else if (geolocate._watchState === 0) {
                geolocate._controlButton.click();
                setTimeout(() => {
                    if (geolocate._controlButton && geolocate._watchState === 2) {
                        geolocate._controlButton.click();
                    }
                }, 100);
            }
        }
    } else {
        // Fallback jika userLocation tidak ada
        alert("Lokasi Anda belum ditemukan. Mencari...");
        geolocate.trigger();
    }
}

// ===============================================
// Fungsi untuk Membatalkan/Menghentikan Navigasi (Tidak berubah)
// ===============================================
function cancelNavigationMode() {
    isNavigating = false;
    wasNavigating = false; 
    clearTimeout(snapBackTimer);
    snapBackTimer = null;
    currentRouteLine = null;

    // 1. Sembunyikan tombol
    startNavBtn.style.display = 'none'; // Tetap sembunyi
    cancelNavBtn.style.display = 'none';
    snapToRoadBtn.style.display = 'none';

    // 2. Hapus rute dari peta
    if (map.getLayer('route')) {
        map.removeLayer('route');
    }
    if (map.getSource('route')) {
        map.removeSource('route');
    }

    // 3. Matikan mode navigasi (follow & heading)
    // Pindah dari state 3 (ACTIVE_HEADING) ke state 2 (ACTIVE_LOCK) atau 0 (OFF)
    if (geolocate._controlButton && geolocate._watchState === 3) {
        geolocate._controlButton.click();
    }
    
    // 4. Reset kamera ke tampilan awal kampus
    map.easeTo({
        center: [lonmap, latmap],
        zoom: 16.5,
        pitch: 45,
        bearing: -17.6,
        duration: 1000
    });
}

// ===============================================
// Fungsi untuk Toggle Snap to Road
// ===============================================
function toggleSnapToRoad() {
    // Balik statusnya
    isSnapToRoadActive = !isSnapToRoadActive;
    console.log("Status Snap to Road:", isSnapToRoadActive);

    // Perbarui tampilan tombol
    if (isSnapToRoadActive) {
        snapToRoadBtn.classList.remove('bg-gray-500');
        snapToRoadBtn.classList.add('bg-blue-500'); // Biru saat aktif
        snapToRoadBtn.setAttribute('title', 'Snap to Road (Aktif)');
    } else {
        snapToRoadBtn.classList.remove('bg-blue-500');
        snapToRoadBtn.classList.add('bg-gray-500'); // Abu-abu saat nonaktif
        snapToRoadBtn.setAttribute('title', 'Snap to Road (Nonaktif)');
    }
}



// ===============================================
// Logika Tombol "Mulai Navigasi"
// ===============================================
startNavBtn.addEventListener('click', startNavigationMode);


// ===============================================
// Logika Tombol "Batal Navigasi"
// ===============================================
cancelNavBtn.addEventListener('click', cancelNavigationMode);


// ===============================================
// Logika "Snap Back"
// ===============================================
snapToRoadBtn.addEventListener('click', toggleSnapToRoad);


// 1. Saat pengguna mulai interaksi, batalkan navigasi & timer
function interruptNavigation() {
    clearTimeout(snapBackTimer);
    
    if (isNavigating) {
        console.log('User interrupted navigation.');
        isNavigating = false;
        wasNavigating = true; 
        
        // Matikan mode 'follow & heading' (state 3) kembali ke 'follow' (state 2)
        if (geolocate._controlButton && geolocate._watchState === 3) {
            geolocate._controlButton.click();
        }
        startNavBtn.style.display = 'none';
    }

}

// ===============================================
// BARU: Listener untuk Tombol Locate
// ===============================================
locateButton.addEventListener('click', () => {
    if (userLocation) {
        // Jika lokasi sudah ditemukan, terbang ke sana
        map.flyTo({
            center: userLocation,
            zoom: 19,
            pitch: 60 // Selalu miringkan saat berpusat
        });
    } else {
        // Jika lokasi belum ada, picu pencarian
        geolocate.trigger();
    }
});

// 2. Saat pengguna selesai, mulai timer
function startSnapBackTimer() {
    clearTimeout(snapBackTimer);
    
    if (wasNavigating && map.getSource('route')) {
        console.log('User stopped. Starting 4-second snap-back timer...');
        cancelNavBtn.style.display = 'flex';
        snapToRoadBtn.style.display = 'flex';
        snapBackTimer = setTimeout(() => {
            console.log('Timer finished. Snapping back to navigation.');
            startNavigationMode();
        }, 4000); 
    }
}

// 3. Pasang listener
map.on('dragstart', interruptNavigation);
map.on('zoomstart', interruptNavigation);

map.on('dragend', startSnapBackTimer);
map.on('zoomend', startSnapBackTimer);


// ===============================================
// BARU: Logika Kompas UI
// ===============================================

/**
 * Memperbarui teks derajat pada UI
 */
function updateRealCompassDegree(degrees) { 
    if (degreeIndicator) {
        const roundedDegrees = Math.round(degrees);
        degreeIndicator.textContent = `${roundedDegrees}°`;
    }
}

/**
 * Menghitung dan menerapkan rotasi ke jarum kompas UI
 * Ini dipanggil oleh handleMapOrientation (saat device bergerak)
 * dan oleh map.on('rotate') (saat peta bergerak)
 */

// function updateCompassRotation() {
//     if (!compassNeedle) return;

//     // Dapatkan bearing peta (seberapa jauh peta diputar)
//     const mapHeading = map.getBearing() || 0;
    
//     // 'lastCompassAlpha' adalah heading absolut perangkat (0-360, 0=Utara)
//     // Kita ingin jarum menunjuk ke 'N' perangkat, relatif terhadap rotasi peta.
//     const targetNeedleHeading = lastCompassAlpha - mapHeading;
    
//     // Terapkan smoothing agar pergerakan jarum tidak patah-patah
//     let needleDelta = targetNeedleHeading - correctedNeedleHeading;
//     if (needleDelta > 180) { needleDelta -= 360; } else if (needleDelta < -180) { needleDelta += 360; }
    
//     correctedNeedleHeading += needleDelta * smoothingFactor;
    
//     // Terapkan rotasi
//     compassNeedle.style.transform = `rotate(${correctedNeedleHeading}deg)`;
// }

function updateCompassRotation() {
    const mapHeading = map.getBearing() || 0;

    // Bagian 1: Update Jarum Kompas UI (Absolute Heading)
    if (compassNeedle) {
        // Target adalah heading absolut perangkat
        const targetNeedleHeading = lastCompassAlpha; 
        
        let needleDelta = targetNeedleHeading - correctedNeedleHeading;
        if (needleDelta > 180) { needleDelta -= 360; } else if (needleDelta < -180) { needleDelta += 360; }
        correctedNeedleHeading += needleDelta * smoothingFactor;
        
        compassNeedle.style.transform = `rotate(${correctedNeedleHeading}deg)`;
    }

    // Bagian 2: Update Kerucut Marker Pengguna (Relative to Map)
    if (userMarker) {
        // Target adalah heading absolut dikurangi rotasi peta
        const targetConeHeading = lastCompassAlpha - mapHeading; 
        
        let coneDelta = targetConeHeading - correctedConeHeading;
        if (coneDelta > 180) { coneDelta -= 360; } else if (coneDelta < -180) { coneDelta += 360; }
        correctedConeHeading += coneDelta * smoothingFactor;

        // Dapatkan elemen HTML dari marker
        const markerEl = userMarker.getElement();
        const headingEl = markerEl.querySelector('.user-location-heading');
        if (headingEl) {
            headingEl.style.transform = `translate(-50%, -50%) rotate(${correctedConeHeading}deg)`;
        }
    }
}

// Alternatif lama tanpa memperhitungkan rotasi peta
// function updateCompassRotation() {
//     if (!compassNeedle) return;

//     // 'lastCompassAlpha' adalah heading absolut perangkat (0-360, 0=Utara)
//     // Kita ingin jarum menunjuk ke heading absolut perangkat, sama seperti angkanya.
//     const targetNeedleHeading = lastCompassAlpha;
    
//     // Terapkan smoothing agar pergerakan jarum tidak patah-patah
//     let needleDelta = targetNeedleHeading - correctedNeedleHeading;
    
//     // Koreksi untuk putaran (misal: dari 350° ke 10°)
//     if (needleDelta > 180) { 
//         needleDelta -= 360; 
//     } else if (needleDelta < -180) { 
//         needleDelta += 360; 
//     }
    
//     correctedNeedleHeading += needleDelta * smoothingFactor;
    
//     // Terapkan rotasi
//     compassNeedle.style.transform = `rotate(${correctedNeedleHeading}deg)`;
    
//     // CATATAN: 'map.getBearing()' sengaja tidak digunakan di sini.
//     // Listener 'map.on('rotate', updateCompassRotation)'
//     // sekarang hanya berfungsi untuk 'memaksa' jarum kompas menghitung ulang
//     // posisinya (menggunakan 'lastCompassAlpha' yang terbaru) saat peta bergerak,
//     // BUKAN untuk mengubah perhitungan itu sendiri.
// }

/**
 * Handler untuk event orientasi perangkat.
 * Ini adalah sumber data untuk heading perangkat.
 */
function handleMapOrientation(event) {
    let alpha = event.webkitCompassHeading || event.alpha;
    if (alpha == null) return;
    
    // (360 - alpha) mengonversi dari 'device north' (0=N)
    const correctedAlpha = (360 - alpha) % 360;
    
    // Smooth 'alpha' untuk mengurangi getaran
    if (smoothedAlpha === null) {
        smoothedAlpha = correctedAlpha;
    } else {
        let diff = correctedAlpha - smoothedAlpha;
        if (diff > 180) { diff -= 360; }
        if (diff < -180) { diff += 360; }
        smoothedAlpha += diff * smoothingFactor;
        smoothedAlpha = (smoothedAlpha % 360 + 360) % 360; // Normalisasi
    }
    
    lastCompassAlpha = smoothedAlpha; 
    updateRealCompassDegree(smoothedAlpha);
    
    // Tampilkan elemen kompas jika masih tersembunyi
    if (compassIndicator && compassIndicator.style.display === 'none') {
        compassIndicator.style.display = 'flex';
    }
    if (degreeIndicator && degreeIndicator.style.display === 'none') {
        degreeIndicator.style.display = 'flex';
    }
    
    // Panggil update rotasi untuk menerapkan heading baru
    updateCompassRotation();
}

/**
 * Mulai mendengarkan event orientasi perangkat
 */
function startMapOrientationListener() {
    if (window.DeviceOrientationEvent) {
        try {
            // 'deviceorientationabsolute' lebih disukai karena tidak terpengaruh oleh orientasi layar
            window.addEventListener('deviceorientationabsolute', handleMapOrientation, true);
        } catch (e) {
            // Fallback jika 'absolute' tidak tersedia
            window.addEventListener('deviceorientation', handleMapOrientation, true);
        }
    }
}

/**
 * Hentikan listener (jika diperlukan)
 */
function stopMapOrientationListener() {
    window.removeEventListener('deviceorientationabsolute', handleMapOrientation, true);
    window.removeEventListener('deviceorientation', handleMapOrientation, true);
}

// ===============================================
// Lain-lain (Tidak berubah)
// ===============================================

// Perbaikan Bug Render Peta
setTimeout(function() {
    map.resize();
}, 500);