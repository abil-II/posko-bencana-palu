'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// ── Types ────────────────────────────────────────────────────────────────────
interface PoskoInfo {
  id: string;
  nama: string;
  kategori: string;
  lon: number;
  lat: number;
  travel_time_seconds: number;
  travel_time_minutes: number;
  distance_meters: number;
  distance_km: number;
  euclidean_meters: number;
  radius_meter: number;
  candidates_count: number;
  road_segments_count: number;
}

interface CandidatePosko {
  id: string;
  nama: string;
  kategori: string;
  lon: number;
  lat: number;
  euclidean_meters: number;
  distance_meters: number;
  distance_km: number;
  travel_time_seconds: number;
  travel_time_minutes: number;
  terpilih: boolean;
}

interface RouteResponse {
  posko_info: PoskoInfo;
  candidates: CandidatePosko[];
  geojson: GeoJSON.FeatureCollection;
}

// ── Dynamic import komponen Peta (SSR = false) ───────────────────────────────
const MapView = dynamic(() => import('./components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-slate-50 gap-3">
      <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
      <div className="text-slate-600 text-sm font-medium">
        Memuat peta Kota Palu...
      </div>
    </div>
  ),
});

// ── Halaman Utama ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const [userLatLng, setUserLatLng] = useState<[number, number] | null>(null);
  const [routeData, setRouteData] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOutOfPaluModalOpen, setIsOutOfPaluModalOpen] = useState(false);

  // Data Peta
  const [allPosko, setAllPosko] = useState<GeoJSON.FeatureCollection | null>(null);
  const [boundaryGeoJSON, setBoundaryGeoJSON] =
    useState<GeoJSON.FeatureCollection | null>(null);

  // Kontrol UI
  const [activeTab, setActiveTab] = useState<'analysis' | 'posko_list'>('analysis');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPoskoCoords, setSelectedPoskoCoords] = useState<
    [number, number] | null
  >(null);
  const [activePoskoId, setActivePoskoId] = useState<string | null>(null);

  const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

  // Muat data posko & batas wilayah saat halaman dibuka
  useEffect(() => {
    let cancelled = false;
    async function loadInitialLayers() {
      try {
        const [poskoRes, boundRes] = await Promise.all([
          fetch(`${BACKEND_URL}/posko`),
          fetch(`${BACKEND_URL}/boundary`),
        ]);

        if (!cancelled) {
          if (poskoRes.ok) setAllPosko(await poskoRes.json());
          if (boundRes.ok) setBoundaryGeoJSON(await boundRes.json());
        }
      } catch {
        // Biarkan UI tetap tampil
      }
    }
    loadInitialLayers();
    return () => {
      cancelled = true;
    };
  }, [BACKEND_URL]);

  // Handler klik peta -> kirim ke backend
  const handleMapClick = useCallback(
    async (lat: number, lon: number) => {
      setUserLatLng([lat, lon]);
      setRouteData(null);
      setError(null);
      setLoading(true);
      setActiveTab('analysis');

      try {
        const res = await fetch(`${BACKEND_URL}/find-route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lon }),
        });

        if (!res.ok) {
          const body = await res.json();
          if (res.status === 400 || (body.detail && body.detail.includes('luar wilayah'))) {
            setIsOutOfPaluModalOpen(true);
            setUserLatLng(null);
            return;
          }
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }

        const data: RouteResponse = await res.json();
        setRouteData(data);
        setActivePoskoId(data.posko_info.id);
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : 'Gagal memuat rute. Silakan coba lagi.',
        );
      } finally {
        setLoading(false);
      }
    },
    [BACKEND_URL],
  );

  const handleReset = () => {
    setUserLatLng(null);
    setRouteData(null);
    setError(null);
    setSelectedPoskoCoords(null);
    setActivePoskoId(null);
  };

  // Filter daftar posko
  const filteredPoskoList = useMemo(() => {
    const features = allPosko?.features ?? [];
    if (!searchQuery.trim()) return features;
    const q = searchQuery.toLowerCase();
    return features.filter(
      (f) =>
        String(f.properties?.nama ?? '')
          .toLowerCase()
          .includes(q) ||
        String(f.properties?.kategori ?? '')
          .toLowerCase()
          .includes(q),
    );
  }, [allPosko, searchQuery]);

  return (
    <div className="flex flex-col h-screen font-sans bg-slate-50 text-slate-900">
      {/* ── Header Utama (Palet Putih & Biru) ── */}
      <header className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-lg bg-blue-700 flex items-center justify-center text-white shadow-xs">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">
                Pencarian Rute Posko Bencana Terdekat
              </h1>
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                Kota Palu
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Layanan Informasi Lokasi Evakuasi & Panduan Rute Darurat Masyarakat Kota Palu
            </p>
          </div>
        </div>

      </header>

      {/* ── Konten Utama ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar Kiri ── */}
        <aside className="w-96 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
          {/* Tab Navigasi Sidebar */}
          <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50/70 p-1.5 gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('analysis')}
              className={`py-2 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'analysis'
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              Rute Evakuasi
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('posko_list')}
              className={`py-2 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'posko_list'
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Daftar Posko ({allPosko?.features.length ?? 0})
            </button>
          </div>

          {/* ── TAB 1: PANDUAN & HASIL RUTE EVAKUASI ── */}
          {activeTab === 'analysis' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Panduan Penggunaan */}
              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100">
                <h2 className="text-xs font-bold uppercase tracking-wider text-blue-900 mb-2">
                  Cara Mencari Posko Terdekat
                </h2>
                <ol className="text-xs text-slate-700 space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      1
                    </span>
                    <span>
                      Klik pada titik lokasi keberadaan Anda di peta Kota Palu.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      2
                    </span>
                    <span>
                      Sistem otomatis mendeteksi posko bencana terdekat di sekitar Anda.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      3
                    </span>
                    <span>
                      Ikuti garis jalur biru pada peta untuk menuju posko dengan waktu paling cepat.
                    </span>
                  </li>
                </ol>
              </div>

              {/* Kondisi Belum Memilih Lokasi */}
              {!userLatLng && !loading && (
                <div className="py-10 px-4 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-2.5">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.8}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </div>
                  <p className="text-xs font-semibold text-slate-700">
                    Tentukan Lokasi Anda di Peta
                  </p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Sentuh atau klik di mana saja pada peta untuk melihat rekomendasi posko evakuasi terdekat beserta jalur jalannya.
                  </p>
                </div>
              )}

              {/* Loading Sederhana */}
              {loading && (
                <div className="py-10 px-4 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white gap-3">
                  <div className="w-7 h-7 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs font-medium text-slate-700">
                    Mencari rute tercepat...
                  </p>
                </div>
              )}

              {/* Pesan Jika Posko Tidak Ditemukan */}
              {error && (
                <div className="p-4 bg-white border border-red-200 rounded-xl shadow-2xs">
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                      !
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-slate-900">
                        Posko Belum Terjangkau dari Titik Ini
                      </p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {error}
                      </p>
                      <button
                        type="button"
                        onClick={handleReset}
                        className="mt-3 text-xs font-semibold text-blue-700 hover:text-blue-800"
                      >
                        Pilih Lokasi Lain
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Hasil Rute Tercepat */}
              {userLatLng && !loading && !error && routeData && (
                <div className="space-y-3.5">
                  {/* Kartu Utama: Rute Tercepat */}
                  <div
                    onClick={() => {
                      setSelectedPoskoCoords([
                        routeData.posko_info.lat,
                        routeData.posko_info.lon,
                      ]);
                      setActivePoskoId(routeData.posko_info.id);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedPoskoCoords([
                          routeData.posko_info.lat,
                          routeData.posko_info.lon,
                        ]);
                        setActivePoskoId(routeData.posko_info.id);
                      }
                    }}
                    className={`p-4 rounded-xl bg-blue-700 text-white shadow-xs cursor-pointer transition-all ${
                      activePoskoId === routeData.posko_info.id
                        ? 'ring-2 ring-blue-300 ring-offset-2 ring-offset-slate-50'
                        : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-800/90 text-blue-100 px-2 py-0.5 rounded">
                        Rute Tercepat
                      </span>
                      <span className="text-[11px] font-medium text-blue-100">
                        Rekomendasi Utama
                      </span>
                    </div>
                    <h3 className="text-sm font-bold leading-snug">
                      {routeData.posko_info.nama}
                    </h3>
                    <p className="text-xs text-blue-100 mt-0.5">
                      {routeData.posko_info.kategori}
                    </p>

                    <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-blue-600">
                      <div>
                        <p className="text-[10px] text-blue-200 uppercase">
                          Estimasi Waktu
                        </p>
                        <p className="text-sm font-bold">
                          {routeData.posko_info.travel_time_minutes} mnt
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-blue-200 uppercase">
                          Jarak Tempuh
                        </p>
                        <p className="text-sm font-bold">
                          {routeData.posko_info.distance_km} km
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-blue-200 uppercase">
                          Radius Area
                        </p>
                        <p className="text-sm font-bold">
                          {(routeData.posko_info.radius_meter / 1000).toFixed(0)} km
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Daftar Posko Berdasarkan Jarak Terdekat */}
                  <div className="p-3.5 rounded-xl bg-white border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Jarak Terdekat
                      </h4>
                      <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                        {routeData.candidates.length} Posko Ditemukan
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {routeData.candidates.map((cand, index) => {
                        const isActiveRoute = activePoskoId === cand.id;
                        return (
                          <button
                            key={cand.id}
                            type="button"
                            onClick={() => {
                              setSelectedPoskoCoords([cand.lat, cand.lon]);
                              setActivePoskoId(cand.id);
                            }}
                            className={`w-full text-left p-2.5 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                              isActiveRoute
                                ? 'bg-blue-50/90 border-blue-400 ring-1 ring-blue-300'
                                : 'bg-slate-50/60 border-slate-200/80 hover:bg-slate-100/70'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    cand.terpilih
                                      ? 'bg-blue-700 text-white'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  {index + 1}
                                </span>
                                <p className="text-xs font-semibold text-slate-900 truncate">
                                  {cand.nama}
                                </p>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Jarak: {cand.distance_km} km · {cand.kategori}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <span
                                className={`text-xs font-bold block ${
                                  cand.terpilih ? 'text-blue-700' : 'text-slate-700'
                                }`}
                              >
                                {cand.travel_time_minutes} mnt
                              </span>
                              {cand.terpilih ? (
                                <span className="text-[10px] font-semibold text-blue-600 block">
                                  Tercepat
                                </span>
                              ) : isActiveRoute ? (
                                <span className="text-[10px] font-medium text-slate-600 block">
                                  Jalur Aktif
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full text-xs font-semibold py-2.5 px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    Cari dari Titik Lokasi Lain
                  </button>
                </div>
              )}

              {/* Keterangan Simbol Peta */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5">
                  Keterangan Peta
                </h4>
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-slate-900 border-2 border-sky-400 inline-block shrink-0 mx-0.5" />
                    <span>Lokasi Pilihan Anda</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-blue-700 border-2 border-white shadow-2xs inline-block shrink-0 mx-0.5" />
                    <span>Posko Tujuan Tercepat</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-sky-600 border-2 border-white shadow-2xs inline-block shrink-0 mx-0.5" />
                    <span>Posko Alternatif di Sekitar Anda</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-slate-500 border-2 border-white shadow-2xs inline-block shrink-0 mx-0.5" />
                    <span>Lokasi Posko Lainnya di Kota Palu</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 h-1 rounded-full bg-blue-700 inline-block shrink-0" />
                    <span>Jalur Rute Tercepat</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 h-3 rounded-xs border border-dashed border-blue-600 bg-blue-500/15 inline-block shrink-0" />
                    <span>Area Jangkauan Pencarian (2, 5, 10, dan 15 km)</span>
                  </div>
                  <div className="flex items-center gap-2.5 pt-1 border-t border-slate-100">
                    <span className="w-3 h-3 rounded-full bg-amber-400 border border-amber-600/40 inline-block shrink-0 mx-0.5" />
                    <span className="text-[11px] leading-tight text-slate-500">
                      Titik Kuning: Fasilitas Umum / POI Bawaan OpenStreetMap (SPBU, pertokoan, halte)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── TAB 2: DAFTAR SELURUH POSKO BENCANA ── */
            <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
              <div>
                <p className="text-xs text-slate-600 mb-2">
                  Daftar posko pengungsian, titik kumpul, dan fasilitas layanan darurat di Kota Palu:
                </p>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama posko atau rumah sakit..."
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {filteredPoskoList.map((feature, idx) => {
                  const coords = (feature.geometry as GeoJSON.Point).coordinates;
                  return (
                    <div
                      key={String(feature.properties?.id ?? idx)}
                      className="p-3 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="inline-block text-[10px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                            {feature.properties?.kategori}
                          </span>
                          <h4 className="text-xs font-bold text-slate-900 mt-1">
                            {feature.properties?.nama}
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPoskoCoords([
                              Number(coords[1]),
                              Number(coords[0]),
                            ])
                          }
                          className="text-[11px] font-semibold text-blue-700 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg border border-blue-200 shrink-0"
                        >
                          Lihat Lokasi
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Sidebar */}
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
            <span>Peta Tanggap Darurat Kota Palu</span>
            <span>Kelompok 3</span>
          </div>
        </aside>

        {/* ── Area Peta ── */}
        <main className="flex-1 relative">
          <MapView
            onMapClick={handleMapClick}
            userLatLng={userLatLng}
            routeGeoJSON={routeData?.geojson ?? null}
            allPoskoGeoJSON={allPosko}
            boundaryGeoJSON={boundaryGeoJSON}
            selectedPoskoCoords={selectedPoskoCoords}
            activePoskoId={activePoskoId}
          />
        </main>
      </div>

      {/* ── Modal Box Peringatan: Titik di Luar Kota Palu ── */}
      {isOutOfPaluModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 text-center transform scale-100 transition-all">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1.5">
              Lokasi di Luar Kota Palu
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed mb-5">
              Titik yang Anda pilih berada di luar batas wilayah administratif Kota Palu. Sistem ini difokuskan khusus untuk penanganan tanggap darurat di area Kota Palu.
            </p>
            <button
              type="button"
              onClick={() => setIsOutOfPaluModalOpen(false)}
              className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs text-white bg-blue-700 hover:bg-blue-800 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              Lanjutkan (Pilih di Kota Palu)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
