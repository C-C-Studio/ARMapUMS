// Inisialisasi Peta
var latmap = -7.5567;
var lonmap = 110.7711;
var map = L.map("map", {
    zoomControl: false,
}).setView([latmap, lonmap], 17);

// Peta OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Variabel untuk menyimpan rute & lokasi pengguna
var routingControl = null;
var userLocation = null;
var isUserOnCampusFlag = false;
let pendingRouteDestination = null; // Untuk menyimpan rute saat lokasi dicari

// ===============================================
// BARU: Elemen untuk Panel Search
// ===============================================
const openSearchBtn = document.getElementById('open-search-btn');
const closeSearchBtn = document.getElementById('close-search-btn');
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const allLocationsList = document.getElementById('all-locations-list');
// const frequentList = document.getElementById('frequent-list'); // (Untuk nanti)
let allLocationsData = []; // Menyimpan data JSON untuk filtering

// ===============================================
// BARU: Fungsi Helper untuk membuat item daftar
// ===============================================
/**
 * Membuat satu item HTML untuk daftar lokasi
 * @param {object} lokasi - Objek lokasi dari JSON
 * @returns {HTMLDivElement} - Elemen div item
 */
function createLocationListItem(lokasi) {
    const itemDiv = document.createElement('div');
    // Tambahkan kelas 'location-item' untuk filtering
    itemDiv.className = 'location-item bg-[#1f3a5f] rounded-xl p-4 flex items-center gap-4 cursor-pointer';
    // Simpan nama lokasi di dataset untuk filtering
    itemDiv.dataset.nama = lokasi.nama.toLowerCase(); 

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

// ===== MEMUAT MARKER (LOKASI GEDUNG) DARI JSON =====
fetch('assets/data/location.json')
    .then(response => response.json())
    .then(data => {
        console.log("Data lokasi berhasil dimuat:", data);
        allLocationsData = data; // Simpan data untuk search
        
        // Kosongkan daftar sebelum mengisi (jika ada)
        allLocationsList.innerHTML = ''; 
        
        data.forEach(lokasi => {
            // 1. Tambahkan marker ke peta
            var marker = L.marker([lokasi.lat, lokasi.lon])
                .addTo(map)
                .bindPopup(`<b>${lokasi.nama}</b><br>${lokasi.deskripsi}`);

            marker.on('click', function() {
                // Panggil logika baru saat marker diklik
                handleRouteRequest(lokasi.lat, lokasi.lon, lokasi.nama);
            });
            
            // 2. BARU: Tambahkan lokasi ke daftar panel pencarian
            const listItem = createLocationListItem(lokasi);
            allLocationsList.appendChild(listItem);
        });
    })
    .catch(error => console.error('Error memuat data lokasi:', error));

// ===== MEMUAT JALUR KUSTOM (VISUAL) DARI JSON =====
fetch('assets/data/path.json')
    .then(response => response.json())
    .then(data => {
        console.log("Data jalur berhasil dimuat:", data);
        var pathStyle = {"color": "#fff34cff", "outlineColor": "#2c2c2cff", "weight": 5, "opacity": 1};
        data.forEach(jalur => {
            L.polyline(jalur.coordinates, pathStyle).addTo(map).bindPopup(jalur.nama);
        });
    })
    .catch(error => console.error('Error memuat data jalur:', error));


// ===============================================
// PERUBAHAN DI SINI: Logika baru untuk menangani permintaan rute
// ===============================================
/**
 * Menangani permintaan untuk membuat rute.
 * Akan SELALU mendapatkan lokasi terbaru pengguna terlebih dahulu.
 */
function handleRouteRequest(lat, lon, nama) {
    // 1. Selalu simpan tujuan yang diminta
    console.log("Permintaan rute diterima. Memperbarui lokasi pengguna...");
    pendingRouteDestination = { lat: lat, lon: lon, nama: nama };
    
    // 2. Selalu panggil map.locate() untuk mendapatkan lokasi terbaru
    map.locate({setView: true, maxZoom: 18});
}

// ===============================================
// Fungsi untuk membuat rute
// ===============================================
function createRoute(destLat, destLon, destName) {
    if (!isUserOnCampusFlag) {
        alert("Fitur rute hanya dapat digunakan saat Anda berada di area kampus UMS.");
        return;
    }
    // Cek userLocation lagi (sebagai pengaman)
    if (!userLocation) {
        alert("Lokasi Anda belum ditemukan. Silakan coba lagi.");
        return;
    }
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }
    var startPoint = userLocation;
    var endPoint = L.latLng(destLat, destLon);
    routingControl = L.Routing.control({
        waypoints: [startPoint, endPoint],
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: true,
        show: false, 
        collapsible: true
    }).addTo(map);
}
    
// ===============================================
// Logika Tombol "Cari Lokasi Saya"
// ===============================================
var locateButton = document.getElementById('locate-btn');
locateButton.addEventListener('click', function() {
    // Hapus rute yang tertunda jika ada, karena pengguna hanya ingin tahu lokasinya
    pendingRouteDestination = null;
    map.locate({setView: true, maxZoom: 18});
});

function onLocationFound(e) {
    var radius = e.accuracy / 2;
    if (window.myLocationMarker) {
        map.removeLayer(window.myLocationMarker);
        map.removeLayer(window.myLocationCircle);
    }
    userLocation = e.latlng; // Selalu perbarui lokasi terbaru
    
    if (isUserOnCampus(userLocation)) {
        isUserOnCampusFlag = true;
        window.myLocationMarker = L.marker(userLocation).addTo(map).bindPopup("Lokasi Anda (Di Kampus)").openPopup();
        window.myLocationCircle = L.circle(userLocation, radius).addTo(map);
        console.log("Status: Pengguna terdeteksi DI DALAM area kampus.");
    } else {
        isUserOnCampusFlag = false; // Pastikan false
        window.myLocationMarker = L.marker(userLocation).addTo(map).bindPopup("Lokasi Anda (Di Luar Kampus)");
        window.myLocationCircle = L.circle(userLocation, radius).addTo(map);
        console.log("Status: Pengguna terdeteksi DI LUAR area kampus.");
        
        // Hanya tampilkan alert jika rute *tidak* sedang tertunda
        if (!pendingRouteDestination) {
            alert("Anda terdeteksi berada di luar area kampus. Fitur rute tidak akan tersedia.");
        }
    }

    // ===============================================
    // Cek apakah ada rute yang tertunda
    // ===============================================
    if (pendingRouteDestination) {
        console.log("Lokasi ditemukan, mencoba membuat rute yang tertunda...");
        createRoute(
            pendingRouteDestination.lat,
            pendingRouteDestination.lon,
            pendingRouteDestination.nama
        );
        // Hapus rute yang tertunda setelah dicoba
        pendingRouteDestination = null; 
    }
}
map.on('locationfound', onLocationFound);

function onLocationError(e) {
    alert("Tidak bisa mendapatkan lokasi Anda. Pastikan GPS dan izin lokasi aktif.");
    // Hapus rute yang tertunda jika gagal
    pendingRouteDestination = null;
}
map.on('locationerror', onLocationError);

// ===============================================
// Logika Auto-Hide Navbar saat Interaksi Peta
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
// BARU: Logika Panel Search (Buka/Tutup/Filter)
// ===============================================
openSearchBtn.addEventListener('click', function() {
    searchPanel.classList.remove('-translate-y-full');
    searchInput.focus(); 
});

closeSearchBtn.addEventListener('click', function() {
    searchPanel.classList.add('-translate-y-full');
});

// Logika klik item daftar
allLocationsList.addEventListener('click', function(e) {
    const clickedItem = e.target.closest('.location-item');
    if (!clickedItem) {
        return;
    }

    const locationBtn = e.target.closest('.location-btn');

    if (locationBtn) {
        // --- Aksi Khusus: Tampilkan Lokasi ---
        const lat = locationBtn.dataset.lat;
        const lon = locationBtn.dataset.lon;
        map.setView([lat, lon], 18);
    } else {
        // --- Aksi Default: Buat Rute ---
        const routeBtn = clickedItem.querySelector('.route-btn');
        if (routeBtn) {
            const lat = routeBtn.dataset.lat;
            const lon = routeBtn.dataset.lon;
            const nama = routeBtn.dataset.nama;
            
            // Panggil fungsi handler baru
            handleRouteRequest(lat, lon, nama);
        }
    }

    searchPanel.classList.add('-translate-y-full');
});

// (Bonus) Logika filter pencarian sederhana
searchInput.addEventListener('keyup', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const items = allLocationsList.getElementsByClassName('location-item');
    
    Array.from(items).forEach(item => {
        const namaLokasi = item.dataset.nama;
        if (namaLokasi.includes(searchTerm)) {
            item.style.display = 'flex'; // Tampilkan jika cocok
        } else {
            item.style.display = 'none'; // Sembunyikan jika tidak cocok
        }
    });
});


// ===============================================
// Perbaikan Bug Render Peta (Spasi Putih)
// ===============================================
setTimeout(function() {
    map.invalidateSize();
}, 500);