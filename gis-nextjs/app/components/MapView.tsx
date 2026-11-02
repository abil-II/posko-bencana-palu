'use client';

import { useEffect } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  GeoJSON,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// ── Fix ikon Leaflet default di Next.js ──────────────────────────────────────
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Ikon SVG Kustom (Tanpa Emoji, Palet Putih & Biru) ────────────────────────
const makePinIcon = (fillColor: string, innerColor: string, size = 26, pulse = false) =>
  L.divIcon({
    html: `
      <div style="position:relative;width:${size}px;height:${Math.round(size * 1.35)}px;display:flex;align-items:center;justify-content:center;">
        ${
          pulse
            ? `<span style="position:absolute;top:2px;width:${size}px;height:${size}px;border-radius:9999px;background:${fillColor};opacity:0.25;transform:scale(1.45);"></span>`
            : ''
        }
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 34" width="${size}" height="${Math.round(size * 1.35)}" style="filter:drop-shadow(0 2px 4px rgba(15,23,42,0.32));">
          <path d="M12 1C6.2 1 1.5 5.7 1.5 11.5c0 7.9 10.5 21 10.5 21s10.5-13.1 10.5-21C22.5 5.7 17.8 1 12 1z" fill="${fillColor}" stroke="#FFFFFF" stroke-width="2"/>
          <circle cx="12" cy="11.5" r="4.5" fill="${innerColor}"/>
        </svg>
      </div>
    `,
    className: '',
    iconSize: [size, Math.round(size * 1.35)],
    iconAnchor: [size / 2, Math.round(size * 1.35)],
    popupAnchor: [0, -Math.round(size * 1.25)],
  });

const ICON_USER = makePinIcon('#0F172A', '#38BDF8', 30, true); // Lokasi Anda
const ICON_BEST = makePinIcon('#1D4ED8', '#FFFFFF', 34, true); // Posko Terdekat
const ICON_CAND = makePinIcon('#0284C7', '#E0F2FE', 27, false); // Posko di Sekitar Anda
const ICON_POSKO = makePinIcon('#475569', '#F8FAFC', 23, false); // Semua Posko

// ── Kota Palu center & bounds ────────────────────────────────────────────────
const PALU_CENTER: [number, number] = [-0.892, 119.87];
const PALU_BOUNDS: L.LatLngBoundsExpression = [
  [-1.08, 119.72],
  [-0.66, 120.04],
];

// ── Types ────────────────────────────────────────────────────────────────────
interface MapViewProps {
  onMapClick: (lat: number, lon: number) => void;
  userLatLng: [number, number] | null;
  routeGeoJSON: GeoJSON.FeatureCollection | null;
  allPoskoGeoJSON: GeoJSON.FeatureCollection | null;
  boundaryGeoJSON: GeoJSON.FeatureCollection | null;
  selectedPoskoCoords: [number, number] | null;
  activePoskoId: string | null;
}

// ── Sub-komponen: klik peta ──────────────────────────────────────────────────
function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ── Sub-komponen: arahkan kamera saat posko dipilih dari daftar ──────────────
function FlyToController({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.8 });
    }
  }, [map, target]);
  return null;
}

// ── Style Layer Peta (Palet Putih & Biru) ────────────────────────────────────
function bufferStyle(): L.PathOptions {
  return {
    color: '#2563EB',
    fillColor: '#3B82F6',
    fillOpacity: 0.1,
    weight: 2,
    dashArray: '6 4',
  };
}

function connectorStyle(): L.PathOptions {
  return {
    color: '#1D4ED8',
    weight: 3.5,
    opacity: 0.85,
    dashArray: '5 5',
    lineCap: 'round',
  };
}

function routeOutlineStyle(): L.PathOptions {
  return {
    color: '#FFFFFF',
    weight: 9,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

function routeStyle(): L.PathOptions {
  return {
    color: '#1D4ED8',
    weight: 5.5,
    opacity: 0.98,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

// ── Komponen Utama MapView ───────────────────────────────────────────────────
export default function MapView({
  onMapClick,
  userLatLng,
  routeGeoJSON,
  allPoskoGeoJSON,
  boundaryGeoJSON,
  selectedPoskoCoords,
  activePoskoId,
}: MapViewProps) {
  const bufferFeatures =
    routeGeoJSON?.features.filter((f) => f.properties?.type === 'buffer') ?? [];
  const candidateFeatures =
    routeGeoJSON?.features.filter((f) => f.properties?.type === 'candidate_posko') ?? [];

  // Tentukan posko aktif yang jalurnya ditampilkan:
  // default ke posko tercepat (terpilih), atau posko yang diklik oleh user
  const effectiveActiveId =
    activePoskoId ||
    candidateFeatures.find((f) => f.properties?.terpilih === true)?.properties?.id ||
    null;

  const connectorFeatures =
    routeGeoJSON?.features.filter(
      (f) =>
        f.properties?.type === 'connector_line' &&
        (!f.properties?.target_posko_id || f.properties?.target_posko_id === effectiveActiveId),
    ) ?? [];

  const routeFeatures =
    routeGeoJSON?.features.filter(
      (f) =>
        f.properties?.type === 'route' &&
        (!f.properties?.target_posko_id || f.properties?.target_posko_id === effectiveActiveId),
    ) ?? [];

  const candidateIds = new Set(
    candidateFeatures.map((f) => String(f.properties?.id ?? '')),
  );

  const geoJsonKey = routeGeoJSON
    ? JSON.stringify(
        routeGeoJSON.features.map(
          (f) => f.properties?.id ?? f.properties?.type ?? '',
        ),
      ) + `-${userLatLng?.[0] ?? 0}-${userLatLng?.[1] ?? 0}-${effectiveActiveId ?? 'none'}`
    : 'empty';

  const backgroundPoskoFeatures =
    allPoskoGeoJSON?.features.filter(
      (f) => !candidateIds.has(String(f.properties?.id ?? '')),
    ) ?? [];

  const boundaryPathOptions: L.PathOptions = {
    color: '#1E40AF',
    weight: 2.5,
    opacity: 0.85,
    fillColor: '#FFFFFF',
    fillOpacity: 0.0,
    dashArray: '8 5',
  };

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={PALU_CENTER}
        zoom={14}
        minZoom={11}
        maxZoom={19}
        maxBounds={PALU_BOUNDS}
        maxBoundsViscosity={0.85}
        preferCanvas={true}
        className="w-full h-full"
        zoomControl={false}
      >
        {/* ── Peta Dasar OpenStreetMap (Peta Detail) ── */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        <ZoomControl position="bottomright" />
        <ClickHandler onMapClick={onMapClick} />
        <FlyToController target={selectedPoskoCoords} />

        {/* ── Batas Wilayah Kota Palu ── */}
        {boundaryGeoJSON && (
          <GeoJSON
            key="palu-boundary"
            data={boundaryGeoJSON}
            style={() => boundaryPathOptions}
            interactive={false}
          />
        )}

        {/* ── Area Radius Pencarian ── */}
        {bufferFeatures.length > 0 && (
          <GeoJSON
            key={`buffer-${geoJsonKey}`}
            data={
              {
                type: 'FeatureCollection',
                features: bufferFeatures,
              } as GeoJSON.FeatureCollection
            }
            style={bufferStyle}
            onEachFeature={(feature, layer) => {
              const radKm = (Number(feature.properties?.radius_meter ?? 2000) / 1000).toFixed(0);
              layer.bindPopup(
                `<div class="text-xs font-sans">
                  <div class="font-semibold text-blue-800">Area Jangkauan Pencarian</div>
                  <div class="text-slate-600 mt-0.5">Radius: <b>${radKm} km</b> dari lokasi Anda</div>
                </div>`,
              );
            }}
          />
        )}

        {/* ── Garis Rute Tercepat ── */}
        {routeFeatures.length > 0 && (
          <>
            <GeoJSON
              key={`route-outline-${geoJsonKey}`}
              data={
                {
                  type: 'FeatureCollection',
                  features: routeFeatures,
                } as GeoJSON.FeatureCollection
              }
              style={routeOutlineStyle}
              interactive={false}
            />
            <GeoJSON
              key={`route-${geoJsonKey}`}
              data={
                {
                  type: 'FeatureCollection',
                  features: routeFeatures,
                } as GeoJSON.FeatureCollection
              }
              style={routeStyle}
              onEachFeature={(feature, layer) => {
                const bestPoskoId = candidateFeatures.find(
                  (f) => f.properties?.terpilih === true,
                )?.properties?.id;
                const isFastest = feature.properties?.target_posko_id === bestPoskoId;
                layer.bindPopup(
                  `<div class="text-xs font-sans">
                    <div class="font-semibold text-blue-800">${
                      isFastest ? 'Rute Tercepat (Rekomendasi Utama)' : 'Rute Evakuasi Alternatif'
                    }</div>
                    <div class="text-slate-600 mt-0.5">Jarak Tempuh: <b>${feature.properties?.distance_km} km</b></div>
                    <div class="text-slate-600">Estimasi Waktu: <b>${feature.properties?.travel_time_minutes} menit</b></div>
                  </div>`,
                );
              }}
            />
          </>
        )}

        {/* ── Garis Penghubung Titik Lokasi ── */}
        {connectorFeatures.length > 0 && (
          <GeoJSON
            key={`connector-${geoJsonKey}`}
            data={
              {
                type: 'FeatureCollection',
                features: connectorFeatures,
              } as GeoJSON.FeatureCollection
            }
            style={connectorStyle}
            interactive={false}
          />
        )}

        {/* ── Semua Titik Posko Bencana ── */}
        {backgroundPoskoFeatures.map((feature, idx) => {
          const coords = (feature.geometry as GeoJSON.Point).coordinates;
          return (
            <Marker
              key={`bg-posko-${feature.properties?.id ?? idx}`}
              position={[coords[1], coords[0]]}
              icon={ICON_POSKO}
            >
              <Popup>
                <div className="text-xs font-sans min-w-[170px]">
                  <div className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium text-[10px] mb-1">
                    {feature.properties?.kategori ?? 'Posko Bencana'}
                  </div>
                  <div className="font-bold text-slate-900 text-sm">
                    {feature.properties?.nama}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ── Posko di Dalam Area Pencarian ── */}
        {candidateFeatures.map((feature, i) => {
          const coords = (feature.geometry as GeoJSON.Point).coordinates;
          const isBest = feature.properties?.terpilih === true;
          return (
            <Marker
              key={`cand-posko-${i}-${geoJsonKey}`}
              position={[coords[1], coords[0]]}
              icon={isBest ? ICON_BEST : ICON_CAND}
              zIndexOffset={isBest ? 1200 : 500}
            >
              <Popup>
                <div className="text-xs font-sans min-w-[190px]">
                  <div
                    className={`inline-block px-2 py-0.5 rounded font-semibold text-[10px] mb-1 ${
                      isBest
                        ? 'bg-blue-700 text-white'
                        : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {isBest ? 'POSKO TERDEKAT' : 'POSKO DI SEKITAR ANDA'}
                  </div>
                  <div className="font-bold text-slate-900 text-sm">
                    {feature.properties?.nama}
                  </div>
                  <div className="text-slate-500 text-[11px] mb-1.5">
                    {feature.properties?.kategori}
                  </div>
                  <div className="border-t border-slate-100 pt-1.5 space-y-0.5 text-slate-700">
                    <div>
                      Jarak Rute: <b>{feature.properties?.distance_km} km</b>
                    </div>
                    <div>
                      Estimasi Waktu: <b>{feature.properties?.travel_time_minutes} menit</b>
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ── Marker Titik Lokasi Pengguna ── */}
        {userLatLng && (
          <Marker position={userLatLng} icon={ICON_USER} zIndexOffset={2000}>
            <Popup>
              <div className="text-xs font-sans">
                <div className="font-bold text-slate-900">Lokasi Pilihan Anda</div>
                <div className="text-slate-500 text-[11px] mt-0.5">
                  Titik awal keberangkatan evakuasi
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
