// Inisialisasi Peta
var latmap = -7.5567;
var lonmap = 110.7711;
// var map = L.map("map").setView([latmap, lonmap], 17);
// SESUDAH
var map = L.map("map", {
    zoomControl: false,
    // scrollWheelZoom: false,
    // doubleClickZoom: false,
    // touchZoom: false,
}).setView([latmap, lonmap], 17);

// Peta OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// BARU: Variabel untuk menyimpan rute & lokasi pengguna
var routingControl = null;
var userLocation = null; // Akan menyimpan L.latLng pengguna
var isUserOnCampusFlag = false; // <-- MODIFIKASI DARI GEOFENCE

// ===== MEMUAT MARKER (LOKASI GEDUNG) DARI JSON =====
fetch('assets/data/location.json') //
    .then(response => response.json())
    .then(data => {
        console.log("Data lokasi berhasil dimuat:", data);
        
        data.forEach(lokasi => {
            var marker = L.marker([lokasi.lat, lokasi.lon])
                .addTo(map)
                // BARU: Modifikasi popup
                .bindPopup(`<b>${lokasi.nama}</b><br>${lokasi.deskripsi}`);

            // BARU: Tambahkan event klik pada marker
            marker.on('click', function() {
                // Panggil fungsi untuk membuat rute saat marker diklik
                createRoute(lokasi.lat, lokasi.lon, lokasi.nama);
            });
        });
    })
    .catch(error => console.error('Error memuat data lokasi:', error));

// ===== MEMUAT JALUR KUSTOM (VISUAL) DARI JSON =====
fetch('assets/data/path.json') //
    .then(response => response.json())
    .then(data => {
        console.log("Data jalur berhasil dimuat:", data);
        
        var pathStyle = {
            "color": "#fff34cff",
            "outlineColor": "#2c2c2cff",
            "weight": 5,
            "opacity": 1
        };

        data.forEach(jalur => {
            L.polyline(jalur.coordinates, pathStyle)
                .addTo(map)
                .bindPopup(jalur.nama);
        });
    })
    .catch(error => console.error('Error memuat data jalur:', error));

// ===============================================
// BARU: Fungsi untuk membuat rute
// ===============================================
function createRoute(destLat, destLon, destName) {
    
    // <-- MODIFIKASI GEOFENCE DIMULAI -->
    if (!isUserOnCampusFlag) {
        alert("Fitur rute hanya dapat digunakan saat Anda berada di area kampus UMS.");
        return; // Hentikan fungsi
    }
    // <-- MODIFIKASI GEOFENCE SELESAI -->

    // 1. Cek apakah kita tahu lokasi pengguna
    if (!userLocation) {
        alert("Harap tekan tombol 'Lokasi Saya' (kanan bawah) terlebih dahulu untuk menentukan titik awal rute.");
        return;
    }

    // 2. Hapus rute lama jika ada
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }

    var startPoint = userLocation;
    var endPoint = L.latLng(destLat, destLon);

    // 3. Buat kontrol rute baru (logika dari maps2.html)
    routingControl = L.Routing.control({
        waypoints: [
            startPoint,
            endPoint
        ],
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: true,
        // BARU: Sembunyikan panel instruksi teks agar UI tetap bersih
        show: false, 
        collapsible: true // Memungkinkan panel disembunyikan
    }).addTo(map);
}
    
// ===============================================
// Logika Tombol "Cari Lokasi Saya"
// ===============================================
var locateButton = document.getElementById('locate-btn');
locateButton.addEventListener('click', function() {
    map.locate({setView: true, maxZoom: 18});
});

// Fungsi saat lokasi ditemukan
function onLocationFound(e) {
    var radius = e.accuracy / 2;
    
    // Hapus marker & lingkaran lokasi lama
    if (window.myLocationMarker) {
        map.removeLayer(window.myLocationMarker);
        map.removeLayer(window.myLocationCircle);
    }
    
    // BARU: Simpan lokasi pengguna secara global
    userLocation = e.latlng; 
    
    // <-- MODIFIKASI GEOFENCE DIMULAI -->
    // Cek apakah lokasi pengguna ada di dalam kampus (memakai fungsi dari geofence.js)
    if (isUserOnCampus(userLocation)) {
        // ---- JIKA DI DALAM KAMPUS ----
        isUserOnCampusFlag = true;
        
        window.myLocationMarker = L.marker(userLocation).addTo(map)
            .bindPopup("Lokasi Anda (Di Kampus)").openPopup();
        
        window.myLocationCircle = L.circle(userLocation, radius).addTo(map);
        
        console.log("Status: Pengguna terdeteksi DI DALAM area kampus.");

    } else {
        // ---- JIKA DI LUAR KAMPUS ----
        isUserOnCampusFlag = false;
        
        window.myLocationMarker = L.marker(userLocation).addTo(map)
            .bindPopup("Lokasi Anda (Di Luar Kampus)"); // Jangan langsung open popup
            
        window.myLocationCircle = L.circle(userLocation, radius).addTo(map);
        
        console.log("Status: Pengguna terdeteksi DI LUAR area kampus.");
        
        // Beri peringatan
        alert("Anda terdeteksi berada di luar area kampus. Fitur rute tidak akan tersedia.");
    }
    // <-- MODIFIKASI GEOFENCE SELESAI -->
}
map.on('locationfound', onLocationFound);

// Fungsi saat lokasi error
function onLocationError(e) {
    alert("Tidak bisa mendapatkan lokasi Anda. Pastikan GPS dan izin lokasi aktif.");
}
map.on('locationerror', onLocationError);

// ===============================================
// Logika Auto-Hide Navbar saat Interaksi Peta
// (Fitur baru dari 'maps.js' kamu)
// ===============================================

// 1. Ambil elemen-elemen yang ingin kita animasikan
const bottomNavbar = document.getElementById('bottom-navbar');
// 'locateButton' sudah dideklarasikan di atas (baris 113)

// 2. Buat variabel untuk menampung timer
let hideControlsTimer = null;

// 3. Fungsi untuk menyembunyikan kontrol
function hideMapControls() {
    // Kita cek 'locateButton' di sini (variabel dari baris 113)
    if (bottomNavbar && locateButton) {
        // Hapus timer "show" yang mungkin sedang berjalan
        clearTimeout(hideControlsTimer);
        
        // Tambahkan kelas Tailwind untuk menggeser elemen ke luar layar
        bottomNavbar.classList.add('translate-y-full'); // Geser navbar ke bawah (sejauh tinggi navbar)
    }
}

// 4. Fungsi untuk memunculkan kembali kontrol
function showMapControls() {
    if (bottomNavbar && locateButton) {
        // Hapus kelas 'translate' untuk mengembalikan ke posisi semula
        bottomNavbar.classList.remove('translate-y-full');
    }
}

// 5. Tambahkan Event Listener ke Peta
//    Saat pengguna MULAI menggerakkan peta (zoom/drag)
map.on('movestart', function() {
    hideMapControls();
});

// 6. Saat pengguna SELESAI menggerakkan peta
map.on('moveend', function() {
    // Hapus timer lama (jika ada, untuk mencegah tumpukan)
    clearTimeout(hideControlsTimer);
    
    // Atur timer baru untuk memunculkan kontrol setelah 2 detik
    hideControlsTimer = setTimeout(() => {
        showMapControls();
    }, 2000); // 2000 milidetik = 2 detik
});

// PERBAIKAN: '}' ekstra dari file maps.js kamu sudah dihapus

// ===============================================
// BARU: Perbaikan Bug Render Peta (Spasi Putih)
// ===============================================
// Memaksa peta untuk menghitung ulang ukurannya setelah layout stabil
setTimeout(function() {
    map.invalidateSize();
}, 500); // Tunda 500ms untuk memastikan semua sudah dimuat