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
    
    // --- Search Panel ---
    openSearchBtn.addEventListener('click', () => { 
        searchPanel.classList.remove('-translate-y-full');
        searchInput.focus();
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

    // --- Filter Search ---
    searchInput.addEventListener('keyup', function(e) { 
        const searchTerm = e.target.value.toLowerCase();
        const items = allLocationsList.getElementsByClassName('location-item');
        Array.from(items).forEach(item => {
            const namaLokasi = item.dataset.nama.toLowerCase(); // Fix case sensitivity
            if (namaLokasi.includes(searchTerm)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
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