import { state } from './state.js';
import { handleRouteRequest } from './navigation.js';

// DOM Elements Lokal
const allLocationsList = document.getElementById('all-locations-list');

export function loadMapData(map) {
    // 1. Muat Lokasi (Marker)
    fetch('assets/data/location.json')
        .then(response => response.json())
        .then(data => {
            allLocationsList.innerHTML = '';
            
            data.forEach(lokasi => {
                // Buat Popup HTML
                const popupHTML = `
                    <div class="bg-white rounded-lg shadow-md p-3 max-w-xs">
                        <h3 class="font-bold text-gray-900">${lokasi.nama}</h3>
                        <p class="text-sm text-gray-600">${lokasi.deskripsi}</p>
                        <button class="route-btn-popup w-full mt-2 bg-blue-500 text-white text-sm font-semibold py-1 px-3 rounded" 
                                data-lat="${lokasi.lat}" 
                                data-lon="${lokasi.lon}" 
                                data-nama="${lokasi.nama}"
                                data-desc="${lokasi.deskripsi}">
                            <i class="fas fa-route mr-1"></i> Rute ke sini
                        </button>
                    </div>`;

                const popup = new maplibregl.Popup({ offset: 25, closeButton: false, className: 'custom-popup' })
                    .setHTML(popupHTML);

                // Marker Merah
                new maplibregl.Marker({ color: "#DC2626" })
                    .setLngLat([lokasi.lon, lokasi.lat])
                    .setPopup(popup)
                    .addTo(map);

                popup.on('open', () => { state.activePopup = popup; });
                popup.on('close', () => { if (state.activePopup === popup) state.activePopup = null; });

                const listItem = createLocationListItem(lokasi);
                allLocationsList.appendChild(listItem);
            });
        })
        .catch(error => console.error('Error memuat lokasi:', error));

    // 2. Muat Jalur Kustom
    fetch('assets/data/path.json')
        .then(response => response.json())
        .then(data => {
            const geojsonData = {
                type: 'FeatureCollection',
                features: data.map(jalur => ({
                    type: 'Feature',
                    properties: { nama: jalur.nama },
                    geometry: {
                        type: 'LineString',
                        coordinates: jalur.coordinates.map(coord => [coord[1], coord[0]])
                    }
                }))
            };

            map.addSource('custom-paths', { type: 'geojson', data: geojsonData });
            map.addLayer({
                id: 'custom-paths-layer',
                type: 'line',
                source: 'custom-paths',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#fff34c', 'line-width': 5, 'line-opacity': 1 }
            });

            map.on('click', 'custom-paths-layer', (e) => {
                new maplibregl.Popup()
                    .setLngLat(e.lngLat)
                    .setHTML(`<b class="text-black">${e.features[0].properties.nama}</b>`)
                    .addTo(map);
            });
        })
        .catch(error => console.error('Error memuat jalur:', error));
}

// Helper
// function createLocationListItem(lokasi) {
//     const itemDiv = document.createElement('div');
//     itemDiv.className = 'location-item bg-[#1f3a5f] rounded-xl p-4 flex items-center gap-4 cursor-pointer';
//     itemDiv.dataset.nama = lokasi.nama.toLowerCase(); 
//     itemDiv.dataset.lat = lokasi.lat;
//     itemDiv.dataset.lon = lokasi.lon;
//     itemDiv.dataset.desc = lokasi.deskripsi;

//     const initial = lokasi.nama.charAt(0).toUpperCase() || 'L';
    
//     itemDiv.innerHTML = `
//         <div class="flex-shrink-0 w-10 h-10 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center font-bold">${initial}</div>
//         <div class="flex-grow min-w-0">
//             <h3 class="text-white font-semibold truncate">${lokasi.nama}</h3>
//             <p class="text-gray-300 text-sm truncate">${lokasi.deskripsi}</p>
//         </div>
//         <div class="flex-shrink-0 flex gap-2">
//             <button class="location-btn w-9 h-9 bg-gray-600/50 text-white rounded-lg flex items-center justify-center"><i class="fas fa-location-dot"></i></button>
//             <button class="route-btn w-9 h-9 bg-gray-600/50 text-white rounded-lg flex items-center justify-center"><i class="fas fa-route"></i></button>
//         </div>
//     `;
//     return itemDiv;
// }

// Versi dengan marquee effect
function createLocationListItem(lokasi) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'location-item bg-[#1f3a5f] rounded-xl p-4 flex items-center gap-4 cursor-pointer relative overflow-hidden';
    
    itemDiv.dataset.nama = lokasi.nama; 
    itemDiv.dataset.lat = lokasi.lat;
    itemDiv.dataset.lon = lokasi.lon;
    itemDiv.dataset.desc = lokasi.deskripsi;

    const initial = lokasi.nama.charAt(0).toUpperCase() || 'L';
    
    itemDiv.innerHTML = `
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center font-bold">
            ${initial}
        </div>
        
        <div class="flex-grow min-w-0 flex flex-col gap-0.5 w-[60%]"> <div class="marquee-container">
                <h3 class="marquee-content text-white font-semibold text-base">
                    ${lokasi.nama}
                </h3>
            </div>
            
            <div class="marquee-container">
                <p class="marquee-content text-gray-300 text-sm">
                    ${lokasi.deskripsi}
                </p>
            </div>
        </div>

        <div class="flex-shrink-0 flex gap-2 z-10 bg-[#1f3a5f] pl-2 shadow-[-10px_0_10px_#1f3a5f]">
            <button class="location-btn w-9 h-9 bg-gray-600/50 text-white rounded-lg flex items-center justify-center"><i class="fas fa-location-dot"></i></button>
            <button class="route-btn w-9 h-9 bg-gray-600/50 text-white rounded-lg flex items-center justify-center"><i class="fas fa-route"></i></button>
        </div>
    `;
    return itemDiv;
}

// Global Listener untuk tombol di dalam Popup (karena innerHTML string)
document.getElementById('map').addEventListener('click', function(e) {
    if (e.target.matches('.route-btn-popup, .route-btn-popup *')) {
        const button = e.target.closest('.route-btn-popup');
        handleRouteRequest(button.dataset.lat, button.dataset.lon, button.dataset.nama, button.dataset.desc); 
        if (state.activePopup) {
            state.activePopup.remove();
            state.activePopup = null;
        }
    }
});