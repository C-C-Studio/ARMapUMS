import { handleRouteRequest } from './navigation.js';
import { state } from './state.js';

const openSearchBtn = document.getElementById('open-search-btn');
const closeSearchBtn = document.getElementById('close-search-btn');
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const allLocationsList = document.getElementById('all-locations-list');
const bottomNavbar = document.getElementById('bottom-navbar');

let hideControlsTimer = null;

export function setupUI(map) {
    // --- Hitung & Jalankan Animasi ---
    const activateMarquee = () => {
        // Ambil semua elemen teks (h3 dan p) yang ada di dalam list
        const contents = document.querySelectorAll('.marquee-content');
        
        contents.forEach(content => {
            const container = content.parentElement;
            
            // Reset dulu agar perhitungan ulang akurat (jika resize layar)
            content.classList.remove('auto-scroll-active');
            content.style.removeProperty('--scroll-dist');
            content.style.removeProperty('animation-duration');
            
            // Hitung selisih lebar (Isi Teks - Lebar Container)
            const overflow = content.scrollWidth - container.clientWidth;

            // Jika teks lebih panjang dari wadahnya (+ toleransi 2px)
            if (overflow > 2) {
                // Set jarak scroll (negatif = ke kiri)
                content.style.setProperty('--scroll-dist', `-${overflow}px`);
                
                // Set durasi dinamis: semakin panjang teks, semakin pelan jalannya
                // Rumus: min 3 detik, ditambah 1 detik setiap 30px overflow
                const duration = 3 + (overflow / 30);
                content.style.animationDuration = `${duration}s`;

                // Jalankan animasi
                content.classList.add('auto-scroll-active');
            }
        });
    };

    // --- Search Panel Listener ---
    openSearchBtn.addEventListener('click', () => { 
        searchPanel.classList.remove('-translate-y-full');
        searchInput.focus();

        // PENTING: Jalankan perhitungan marquee setelah transisi panel selesai/dimulai
        // Kita beri jeda sedikit (300ms) agar panel sudah tampil dan punya lebar
        setTimeout(activateMarquee, 300);
    });

    closeSearchBtn.addEventListener('click', () => { 
        searchPanel.classList.add('-translate-y-full');
    });

    // --- Klik List Item ---
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
            // AMBIL NAMA & DESKRIPSI dari elemen HTML
            const namaAsli = item.querySelector('h3').textContent; 
            // const deskripsiAsli = item.querySelector('p').textContent; // Ambil teks dari tag <p>
            const deskripsiAsli = item.dataset.desc;

            // PANGGIL handleRouteRequest dengan parameter lengkap
            handleRouteRequest(item.dataset.lat, item.dataset.lon, namaAsli, deskripsiAsli);
        }
        searchPanel.classList.add('-translate-y-full');
    });

    // --- Filter Search Listener (Update juga saat mengetik) ---
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

        // Hitung ulang animasi untuk item yang baru tampil
        // Beri jeda agar rendering layout selesai
        setTimeout(activateMarquee, 100);
    });

    // --- Navbar Auto Hide ---
    map.once('idle', () => {
        map.on('movestart', hideMapControls);
    });
    map.on('moveend', function() {
        clearTimeout(hideControlsTimer);
        hideControlsTimer = setTimeout(showMapControls, 1000);
    });
}

function hideMapControls() {
    if (bottomNavbar) {
        clearTimeout(hideControlsTimer);
        bottomNavbar.classList.add('translate-y-full');
    }
}

function showMapControls() {
    if (state.isNavigating || state.wasNavigating || state.isPreviewingRoute) return;

    if (bottomNavbar) {
        bottomNavbar.classList.remove('translate-y-full');
    }
}