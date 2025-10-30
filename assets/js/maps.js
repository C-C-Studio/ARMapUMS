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
    
    // Tambahkan marker & lingkaran baru
    window.myLocationMarker = L.marker(userLocation).addTo(map).bindPopup("Lokasi Anda").openPopup();
    window.myLocationCircle = L.circle(userLocation, radius).addTo(map);
}
map.on('locationfound', onLocationFound);

// Fungsi saat lokasi error
function onLocationError(e) {
    alert("Tidak bisa mendapatkan lokasi Anda. Pastikan GPS dan izin lokasi aktif.");
}
map.on('locationerror', onLocationError);