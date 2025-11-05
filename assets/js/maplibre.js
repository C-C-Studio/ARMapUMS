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

// ===============================================
// BARU: Variabel Status Navigasi & Timer
// ===============================================
let isNavigating = false; // Status apakah kita dalam mode navigasi
let wasNavigating = false; // BARU: Flag untuk melacak jika navigasi diinterupsi
let snapBackTimer = null; // Timer untuk 'snap back'


// ===============================================
// Panel Search & Tombol Navigasi
// ===============================================
const openSearchBtn = document.getElementById('open-search-btn');
const closeSearchBtn = document.getElementById('close-search-btn');
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const allLocationsList = document.getElementById('all-locations-list');
const startNavBtn = document.getElementById('start-nav-btn');
const cancelNavBtn = document.getElementById('cancel-nav-btn');
let allLocationsData = [];

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

// ===============================================
// Logika Memuat Data (Marker & Jalur) (Tidak berubah)
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
});

// ===============================================
// Fungsi untuk membuat rute
// ===============================================
async function createRoute(destLat, destLon, destName) {
    clearTimeout(snapBackTimer); // Hentikan timer 'snap back'
    snapBackTimer = null;
    isNavigating = false;     // Kita tidak sedang bernavigasi
    wasNavigating = false;  // Kita juga tidak "baru saja" menginterupsi
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
// Logika Lokasi Pengguna (Tidak berubah)
// ===============================================
const geolocate = new maplibregl.GeolocateControl({
    positionOptions: {
        enableHighAccuracy: true
    },
    trackUserLocation: true, 
    showUserHeading: true    
});

map.addControl(geolocate, 'bottom-right');

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
    
    userLocation = [userLng, userLat];
    
    const userLngLat = new maplibregl.LngLat(userLng, userLat);

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
        const namaLokasi = item.dataset.nama;
        if (namaLokasi.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
});


// ===============================================
// BARU: Fungsi untuk Masuk ke Mode Navigasi
// ===============================================
function startNavigationMode() {
    // 1. Set status & Sembunyikan/Tampilkan tombol
    isNavigating = true;
    wasNavigating = false; // BARU: Reset flag 'wasNavigating'
    startNavBtn.style.display = 'none';
    cancelNavBtn.style.display = 'flex';
    
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
// BARU: Fungsi untuk Membatalkan/Menghentikan Navigasi
// ===============================================
function cancelNavigationMode() {
    isNavigating = false;
    wasNavigating = false; // BARU: Reset flag 'wasNavigating'
    clearTimeout(snapBackTimer);
    snapBackTimer = null;

    // 1. Sembunyikan tombol
    startNavBtn.style.display = 'none'; // Tetap sembunyi
    cancelNavBtn.style.display = 'none';

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
// Logika Tombol "Mulai Navigasi" (DISEDERHANAKAN)
// ===============================================
startNavBtn.addEventListener('click', startNavigationMode);


// ===============================================
// Logika Tombol "Batal Navigasi" (DISEDERHANAKAN)
// ===============================================
cancelNavBtn.addEventListener('click', cancelNavigationMode);


// ===============================================
// BARU: Logika "Snap Back"
// ===============================================

// 1. Saat pengguna mulai interaksi, batalkan navigasi & timer
function interruptNavigation() {
    clearTimeout(snapBackTimer);
    
    if (isNavigating) {
        console.log('User interrupted navigation.');
        isNavigating = false;
        wasNavigating = true; // BARU: Tandai bahwa kita BARU SAJA menginterupsi
        
        // Matikan mode 'follow & heading' (state 3) kembali ke 'follow' (state 2)
        if (geolocate._controlButton && geolocate._watchState === 3) {
            geolocate._controlButton.click();
        }
    }

    // Sembunyikan tombol saat menggeser
    startNavBtn.style.display = 'none';
    cancelNavBtn.style.display = 'none';
}

// 2. Saat pengguna selesai, mulai timer
function startSnapBackTimer() {
    clearTimeout(snapBackTimer);
    
    // DIUBAH: Cek 'wasNavigating', BUKAN 'map.getSource('route')'
    if (wasNavigating && map.getSource('route')) {
        console.log('User stopped. Starting 4-second snap-back timer...');
        snapBackTimer = setTimeout(() => {
            // Setelah 4 detik, panggil fungsi 'Mulai Navigasi' lagi
            console.log('Timer finished. Snapping back to navigation.');
            startNavigationMode();
        }, 4000); // 4000 milidetik = 4 detik
    }
}

// 3. Pasang listener
map.on('dragstart', interruptNavigation);
map.on('zoomstart', interruptNavigation);

map.on('dragend', startSnapBackTimer);
map.on('zoomend', startSnapBackTimer);


// Perbaikan Bug Render Peta (Sama)
setTimeout(function() {
    map.resize();
}, 500);