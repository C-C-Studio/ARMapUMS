// Inisialisasi Peta
var latmap = -7.5567;
var lonmap = 110.7711;
var map = L.map("map").setView([latmap, lonmap], 17);

// Peta OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// ===== MEMUAT MARKER (LOKASI GEDUNG) DARI JSON =====
fetch('assets/data/location.json')
    .then(response => response.json())
    .then(data => {
        console.log("Data lokasi berhasil dimuat:", data);
        data.forEach(lokasi => {
            L.marker([lokasi.lat, lokasi.lon])
                .addTo(map)
                .bindPopup(`<b>${lokasi.nama}</b><br>${lokasi.deskripsi}`);
        });
    })
    .catch(error => console.error('Error memuat data lokasi:', error));

// ===== BARU: MEMUAT JALUR KUSTOM DARI JSON =====
fetch('assets/data/path.json')
    .then(response => response.json())
    .then(data => {
        console.log("Data jalur berhasil dimuat:", data);
        
        // Atur style/gaya untuk jalur Anda
        var pathStyle = {
            "color": "#fff34cff",  // Warna biru
            "outlineColor": "#2c2c2cff",
            "weight": 5,         // Ketebalan garis
            "opacity": 1
        };

        data.forEach(jalur => {
            // Gambar jalur ke peta menggunakan L.polyline
            L.polyline(jalur.coordinates, pathStyle)
                .addTo(map)
                .bindPopup(jalur.nama); // Tambahkan popup (opsional)
        });
    })
    .catch(error => console.error('Error memuat data jalur:', error));
// ===============================================

    
// Logika Tombol "Cari Lokasi Saya"
var locateButton = document.getElementById('locate-btn');
locateButton.addEventListener('click', function() {
    map.locate({setView: true, maxZoom: 18});
});

// Fungsi saat lokasi ditemukan
function onLocationFound(e) {
    var radius = e.accuracy / 2;
    // Hapus marker & lingkaran lokasi lama jika ada
    if (window.myLocationMarker) {
        map.removeLayer(window.myLocationMarker);
        map.removeLayer(window.myLocationCircle);
    }
    
    // Tambahkan marker & lingkaran baru
    window.myLocationMarker = L.marker(e.latlng).addTo(map).bindPopup("Lokasi Anda").openPopup();
    window.myLocationCircle = L.circle(e.latlng, radius).addTo(map);
}
map.on('locationfound', onLocationFound);

// Fungsi saat lokasi error
function onLocationError(e) {
    alert("Tidak bisa mendapatkan lokasi Anda. Pastikan GPS dan izin lokasi aktif.");
}
map.on('locationerror', onLocationError);