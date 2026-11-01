"""
Sistem Pencarian Rute Tercepat Menuju Posko Bencana Alam di Kota Palu
Backend FastAPI — Kelompok 3 AFL2 Compgraph

Alur Sesuai Proposal:
1. Ekstraksi 3 Spatial Layers Vektor Murni dari OpenStreetMap (OSM):
   - Layer 1 (Polygon): Batas wilayah administratif Kota Palu
   - Layer 2 (LineString): Struktur jaringan jalan raya & gang kecil Kota Palu beserta panjang ruas (meter)
   - Layer 3 (Point): Titik lokasi posko bencana alam (via ox.features_from_place) & titik pengguna
2. Transformasi CRS dari EPSG:4326 (WGS 84) ke EPSG:32750 (UTM Zona 50S) menggunakan to_crs().
3. Operasi GIS 1 — Buffering adaptif: 2.000 meter (2 km) -> 5.000 m (5 km) -> 10.000 m (10 km) -> 15.000 m (15 km).
4. Operasi GIS 2 — Spatial Join (gpd.sjoin) dengan predikat topologi 'intersects'.
5. Proyeksi presisi titik ke ruas jalan/gang terdekat (edge projection) & Pathfinding Algoritma A* (A-Star)
   dari titik awal pengguna hingga tepat ke titik posko tujuan.
6. Pengembalian GeoJSON (EPSG:4326) untuk divisualisasikan pada antarmuka web Next.js.
"""

import json
import logging
import math
from contextlib import asynccontextmanager
from typing import Any

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from shapely.geometry import LineString, Point
from shapely.ops import substring

# ──────────────────────────────────────────────────────────
# Konfigurasi logging
# ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("gis-palu")

# ──────────────────────────────────────────────────────────
# Konstanta CRS
# ──────────────────────────────────────────────────────────
CRS_GEO = "EPSG:4326"   # WGS84 — input/output frontend (derajat)
CRS_UTM = "EPSG:32750"  # UTM Zona 50S — perhitungan planar metrik (meter)

# ──────────────────────────────────────────────────────────
# Tag OpenStreetMap untuk Ekstraksi Titik Posko Shelter / Pengungsian Real-time
# Di OSM Kota Palu, posko pengungsian terdaftar resmi dengan skema shelter/assembly_point
# ──────────────────────────────────────────────────────────
OSM_POSKO_TAGS: dict[str, Any] = {
    "social_facility": "shelter",
    "amenity": "shelter",
    "emergency": "assembly_point",
}

# ──────────────────────────────────────────────────────────
# [ARSIP / CADANGAN] Dataset Posko Hardcode
# Disimpan sebagai komentar sesuai instruksi (just in case API OSM gagal/offline)
# ──────────────────────────────────────────────────────────
# POSKO_DATA_FALLBACK = [
#     {"id": "P01", "nama": "Posko Mako Brimob Polda Sulteng",      "lon": 119.893064, "lat": -0.855826},
#     {"id": "P02", "nama": "Posko Lapangan Vatulemo (Wali Kota)", "lon": 119.877881, "lat": -0.893121},
#     {"id": "P03", "nama": "Posko Dinas Sosial Kota Palu",        "lon": 119.873215, "lat": -0.899120},
#     {"id": "P04", "nama": "Posko Kantor BPBD Kota Palu",         "lon": 119.876100, "lat": -0.885400},
#     {"id": "P05", "nama": "Posko Stadion Gawalise (Palu Barat)",  "lon": 119.838500, "lat": -0.891200},
#     {"id": "P06", "nama": "Posko RSUD Undata Palu",              "lon": 119.886200, "lat": -0.852100},
#     {"id": "P07", "nama": "Posko Universitas Tadulako (Untad)",  "lon": 119.896500, "lat": -0.838100},
#     {"id": "P08", "nama": "Posko Kelurahan Balaroa",             "lon": 119.843200, "lat": -0.898500},
#     {"id": "P09", "nama": "Posko Kelurahan Petobo",              "lon": 119.902100, "lat": -0.928400},
#     {"id": "P10", "nama": "Posko Lapangan Anoa Tatura",          "lon": 119.881200, "lat": -0.911500},
# ]

# ──────────────────────────────────────────────────────────
# State global (dimuat sekali saat startup)
# ──────────────────────────────────────────────────────────
state: dict[str, Any] = {}


def _classify_posko_category(row: pd.Series) -> str:
    """Tentukan kategori posko pengungsian berdasarkan data shelter OSM."""
    emergency_val = str(row.get("emergency", "") or "").lower()
    if emergency_val == "assembly_point":
        return "Titik Kumpul Evakuasi"
    return "Posko Pengungsian (Shelter)"


def _extract_posko_from_osm() -> gpd.GeoDataFrame:
    """
    Tarik langsung titik lokasi posko & fasilitas darurat Kota Palu dari API OpenStreetMap
    menggunakan ox.features_from_place(), lalu konversi ke primitif Point (EPSG:4326).
    """
    logger.info(
        "Mengunduh titik posko & fasilitas darurat Kota Palu dari API OpenStreetMap (ox.features_from_place) ..."
    )
    raw_gdf = ox.features_from_place("Palu, Indonesia", tags=OSM_POSKO_TAGS)
    raw_gdf = raw_gdf.reset_index()

    if raw_gdf.crs is None:
        raw_gdf = raw_gdf.set_crs(CRS_GEO)
    else:
        raw_gdf = raw_gdf.to_crs(CRS_GEO)

    utm_geoms = raw_gdf.to_crs(CRS_UTM).geometry.centroid
    point_geoms_geo = gpd.GeoSeries(utm_geoms, crs=CRS_UTM).to_crs(CRS_GEO)

    records: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    for idx, row in raw_gdf.iterrows():
        raw_name = row.get("name")
        emergency_tag = row.get("emergency")

        if pd.isna(raw_name) or not str(raw_name).strip():
            if str(emergency_tag) == "assembly_point":
                raw_name = "Titik Kumpul Evakuasi Darurat"
            else:
                continue

        clean_name = str(raw_name).strip()
        norm_key = clean_name.lower()

        if norm_key in seen_names and norm_key != "titik kumpul evakuasi darurat":
            continue
        seen_names.add(norm_key)

        pt: Point = point_geoms_geo.iloc[idx]
        kategori = _classify_posko_category(row)

        records.append(
            {
                "osm_id": str(row.get("id", idx)),
                "nama": clean_name,
                "kategori": kategori,
                "lon": round(float(pt.x), 6),
                "lat": round(float(pt.y), 6),
                "geometry": Point(round(float(pt.x), 6), round(float(pt.y), 6)),
            }
        )

    priority_order = {
        "Posko Pengungsian & Titik Kumpul": 0,
        "Area Evakuasi Terbuka": 1,
        "Fasilitas Medis & Logistik Darurat": 2,
        "Posko Komando & Tanggap Darurat": 3,
    }
    records.sort(key=lambda r: (priority_order.get(r["kategori"], 9), r["nama"]))

    for i, rec in enumerate(records, start=1):
        rec["id"] = f"P{i:02d}"
        if rec["nama"] == "Titik Kumpul Evakuasi Darurat":
            rec["nama"] = f"Titik Kumpul Evakuasi ({rec['id']})"

    posko_gdf = gpd.GeoDataFrame(records, geometry="geometry", crs=CRS_GEO)
    return posko_gdf


def _get_edge_linestring(G: nx.MultiDiGraph, u: int, v: int, data: dict[str, Any]) -> LineString:
    """Ambil geometry LineString dari edge (u, v) atau bangun garis lurus antar node jika tidak ada."""
    geom = data.get("geometry")
    if geom is not None:
        return geom
    pt_u = (float(G.nodes[u]["x"]), float(G.nodes[u]["y"]))
    pt_v = (float(G.nodes[v]["x"]), float(G.nodes[v]["y"]))
    return LineString([pt_u, pt_v])


def _build_bidirectional_routing_graph(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """
    Pastikan setiap ruas jalan & gang kecil memiliki akses dua arah untuk evakuasi darurat
    dengan geometri LineString yang terorientasi secara akurat dari node u ke node v.
    """
    G_bi = G.copy()
    edges_to_add = []

    for u, v, k, data in G_bi.edges(keys=True, data=True):
        geom = _get_edge_linestring(G_bi, u, v, data)
        data["geometry"] = geom

        if not G_bi.has_edge(v, u):
            rev_data = dict(data)
            rev_coords = list(geom.coords)[::-1]
            rev_data["geometry"] = LineString(rev_coords)
            edges_to_add.append((v, u, rev_data))

    for v, u, rev_data in edges_to_add:
        G_bi.add_edge(v, u, **rev_data)

    return G_bi


def _build_roads_geojson(G: nx.MultiDiGraph) -> dict[str, Any]:
    """
    Ekstraksi Layer 2 (LineString): Struktur jaringan jalan raya & gang Kota Palu
    beserta atribut panjang ruas jalan dalam satuan meter.
    """
    G_undirected = ox.convert.to_undirected(G)
    edges_gdf = ox.graph_to_gdfs(G_undirected, nodes=False, edges=True)
    if edges_gdf.crs is None:
        edges_gdf = edges_gdf.set_crs(CRS_GEO)
    else:
        edges_gdf = edges_gdf.to_crs(CRS_GEO)

    features: list[dict[str, Any]] = []
    for _, row in edges_gdf.iterrows():
        geom = row.geometry
        if geom is None:
            continue
        highway = row.get("highway", "road")
        if isinstance(highway, list):
            highway = highway[0]
        name = row.get("name")
        if isinstance(name, list):
            name = name[0]
        name_str = str(name) if pd.notna(name) else "Ruas Jalan / Gang"
        length_m = round(float(row.get("length", 0.0)), 1)

        if geom.geom_type == "LineString":
            coords = [[round(c[0], 5), round(c[1], 5)] for c in geom.coords]
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {
                        "name": name_str,
                        "highway": str(highway),
                        "length_m": length_m,
                    },
                }
            )

    return {"type": "FeatureCollection", "features": features}


def _load_palu_data() -> None:
    """Unduh & siapkan ke-3 Spatial Layers Kota Palu dari OpenStreetMap (termasuk gang kecil)."""
    # ── Layer 2: Jaringan Jalan Raya & Gang Kecil Kota Palu (network_type="all") ──
    logger.info("Mengunduh graph jaringan jalan & gang kecil Kota Palu dari OpenStreetMap ...")
    G_raw = ox.graph_from_place("Palu, Indonesia", network_type="all", simplify=True)
    G_raw = ox.add_edge_speeds(G_raw)
    G_raw = ox.add_edge_travel_times(G_raw)

    # Buat graph routing dua arah agar rute masuk hingga ke gang kecil posko secara akurat
    G = _build_bidirectional_routing_graph(G_raw)
    G_proj = ox.project_graph(G, to_crs=CRS_UTM)

    state["G"] = G
    state["G_proj"] = G_proj

    logger.info("Menyiapkan GeoJSON Layer LineString jaringan jalan & gang Kota Palu ...")
    roads_geojson = _build_roads_geojson(G_raw)
    state["roads_geojson"] = roads_geojson

    # ── Layer 1: Poligon Batas Wilayah Kota Palu (Polygon / MultiPolygon) ──
    logger.info("Mengunduh batas wilayah administratif Kota Palu (Polygon) ...")
    city_gdf = ox.geocode_to_gdf("Palu, Indonesia")
    if city_gdf.crs is None:
        city_gdf = city_gdf.set_crs(CRS_GEO)
    else:
        city_gdf = city_gdf.to_crs(CRS_GEO)

    state["city_gdf"] = city_gdf
    state["city_gdf_utm"] = city_gdf.to_crs(CRS_UTM)
    state["boundary_geojson"] = json.loads(
        city_gdf[["geometry", "display_name"]].to_json()
        if "display_name" in city_gdf.columns
        else city_gdf[["geometry"]].to_json()
    )

    # ── Layer 3: Titik Posko Bencana Alam (Point) via ox.features_from_place ──
    posko_gdf = _extract_posko_from_osm()
    state["posko_gdf"] = posko_gdf
    state["posko_gdf_utm"] = posko_gdf.to_crs(CRS_UTM)
    state["posko_geojson"] = json.loads(posko_gdf.to_json())

    logger.info(
        "Data GIS Kota Palu siap: %d node jalan/gang, %d segmen LineString, %d titik Point posko.",
        len(G.nodes),
        len(roads_geojson["features"]),
        len(posko_gdf),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load data OSM saat aplikasi pertama kali dijalankan."""
    _load_palu_data()
    yield
    state.clear()


# ──────────────────────────────────────────────────────────
# Aplikasi FastAPI
# ──────────────────────────────────────────────────────────
app = FastAPI(
    title="GIS Posko Bencana Kota Palu",
    description="Backend pencarian rute tercepat menuju posko bencana alam di Kota Palu berbasis OpenStreetMap.",
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────
# Schema Request / Response
# ──────────────────────────────────────────────────────────
class LocationRequest(BaseModel):
    lat: float = Field(..., description="Latitude titik pengguna (WGS84 / EPSG:4326)", ge=-90, le=90)
    lon: float = Field(..., description="Longitude titik pengguna (WGS84 / EPSG:4326)", ge=-180, le=180)


# ──────────────────────────────────────────────────────────
# Helper Pathfinding A* & Edge-Level Snapping Presisi
# ──────────────────────────────────────────────────────────
def _heuristic_astar(u: int, v: int) -> float:
    """
    Heuristik jarak Euclidean planar untuk Algoritma A*
    menggunakan koordinat meter pada graph terproyeksi UTM Zona 50S (EPSG:32750).
    """
    G_proj: nx.MultiDiGraph = state["G_proj"]
    xu, yu = G_proj.nodes[u]["x"], G_proj.nodes[u]["y"]
    xv, yv = G_proj.nodes[v]["x"], G_proj.nodes[v]["y"]
    dist_meter = math.hypot(xu - xv, yu - yv)
    return dist_meter / 22.22


def _append_coords_clean(target: list[list[float]], new_coords: list[tuple[float, float] | list[float]]) -> None:
    """Tambahkan koordinat ke list tanpa titik duplikat berurutan."""
    for c in new_coords:
        pt = [round(float(c[0]), 6), round(float(c[1]), 6)]
        if not target or target[-1] != pt:
            target.append(pt)


def _compute_precise_route(
    G: nx.MultiDiGraph,
    orig_lon: float,
    orig_lat: float,
    orig_edge: tuple[int, int, int],
    dest_lon: float,
    dest_lat: float,
    dest_edge: tuple[int, int, int],
) -> tuple[list[list[float]], list[list[float]], list[list[float]], float, float, int]:
    """
    Hitung rute jalan tercepat A* dengan proyeksi presisi pada segmen jalan/gang (edge):
    - Memotong segmen jalan awal tepat dari titik proyeksi pengguna (bukan melompat ke persimpangan jauh)
    - Memotong segmen jalan akhir tepat di titik jalan terdekat di depan posko
    - Menyambungkan garis utuh dari titik pengguna -> jalan/gang -> titik posko.
    """
    u_o, v_o, k_o = orig_edge
    u_d, v_d, k_d = dest_edge

    orig_data = G[u_o][v_o][k_o]
    dest_data = G[u_d][v_d][k_d]

    orig_line: LineString = _get_edge_linestring(G, u_o, v_o, orig_data)
    dest_line: LineString = _get_edge_linestring(G, u_d, v_d, dest_data)

    orig_pt = Point(orig_lon, orig_lat)
    dest_pt = Point(dest_lon, dest_lat)

    # Posisi ternormalisasi (0.0 s/d 1.0) sepanjang segmen LineString jalan terdekat
    alpha_o = float(orig_line.project(orig_pt, normalized=True))
    alpha_d = float(dest_line.project(dest_pt, normalized=True))

    snap_orig_pt = orig_line.interpolate(alpha_o, normalized=True)
    snap_dest_pt = dest_line.interpolate(alpha_d, normalized=True)

    orig_len_m = float(orig_data.get("length", 0.0))
    orig_time_s = float(orig_data.get("travel_time", max(1.0, orig_len_m / 8.33)))

    dest_len_m = float(dest_data.get("length", 0.0))
    dest_time_s = float(dest_data.get("travel_time", max(1.0, dest_len_m / 8.33)))

    road_coords: list[list[float]] = []

    # Kasus khusus: titik awal dan posko berada di ruas jalan yang sama
    if (u_o == u_d and v_o == v_d) or (u_o == v_d and v_o == u_d):
        if u_o == v_d and v_o == u_d:
            alpha_d_same = 1.0 - alpha_d
        else:
            alpha_d_same = alpha_d
        seg_geom = substring(orig_line, alpha_o, alpha_d_same, normalized=True)
        frac = abs(alpha_d_same - alpha_o)
        total_dist_m = orig_len_m * frac
        total_time_s = orig_time_s * frac
        if seg_geom.geom_type == "Point":
            _append_coords_clean(road_coords, [(seg_geom.x, seg_geom.y)])
        else:
            _append_coords_clean(road_coords, list(seg_geom.coords))
        segment_count = 1
    else:
        # Evaluasi kombinasi keluar dari edge awal (menuju u_o atau v_o)
        # dan masuk ke edge tujuan (dari u_d atau v_d) untuk mendapatkan waktu tempuh minimum
        orig_candidates = [
            (u_o, alpha_o * orig_time_s, alpha_o * orig_len_m, substring(orig_line, alpha_o, 0.0, normalized=True)),
            (v_o, (1.0 - alpha_o) * orig_time_s, (1.0 - alpha_o) * orig_len_m, substring(orig_line, alpha_o, 1.0, normalized=True)),
        ]
        dest_candidates = [
            (u_d, alpha_d * dest_time_s, alpha_d * dest_len_m, substring(dest_line, 0.0, alpha_d, normalized=True)),
            (v_d, (1.0 - alpha_d) * dest_time_s, (1.0 - alpha_d) * dest_len_m, substring(dest_line, 1.0, alpha_d, normalized=True)),
        ]

        best_combo = None
        best_total_time = float("inf")

        for start_node, t_start, d_start, geom_start in orig_candidates:
            for end_node, t_end, d_end, geom_end in dest_candidates:
                try:
                    if start_node == end_node:
                        node_path = [start_node]
                        mid_time = 0.0
                        mid_dist = 0.0
                    else:
                        node_path = nx.astar_path(
                            G,
                            start_node,
                            end_node,
                            heuristic=_heuristic_astar,
                            weight="travel_time",
                        )
                        mid_time = 0.0
                        mid_dist = 0.0
                        for i in range(len(node_path) - 1):
                            nu, nv = node_path[i], node_path[i + 1]
                            be = min(
                                G[nu][nv].values(),
                                key=lambda d: d.get("travel_time", float("inf")),
                            )
                            mid_time += float(be.get("travel_time", 0.0))
                            mid_dist += float(be.get("length", 0.0))

                    cand_time = t_start + mid_time + t_end
                    cand_dist = d_start + mid_dist + d_end
                    if cand_time < best_total_time:
                        best_total_time = cand_time
                        best_combo = (node_path, geom_start, geom_end, cand_time, cand_dist)
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    continue

        if best_combo is None:
            raise nx.NetworkXNoPath("Tidak ditemukan jalur antar segmen.")

        node_path, geom_start, geom_end, total_time_s, total_dist_m = best_combo

        # 1. Tambahkan potongan segmen jalan awal (dari titik proyeksi pengguna ke node persimpangan pertama)
        if geom_start.geom_type == "LineString":
            _append_coords_clean(road_coords, list(geom_start.coords))
        else:
            _append_coords_clean(road_coords, [(snap_orig_pt.x, snap_orig_pt.y)])

        # 2. Tambahkan seluruh segmen jalan hasil A* di antara start_node dan end_node
        for i in range(len(node_path) - 1):
            nu, nv = node_path[i], node_path[i + 1]
            edge_data = min(
                G[nu][nv].values(),
                key=lambda d: d.get("travel_time", float("inf")),
            )
            if "geometry" in edge_data and edge_data["geometry"] is not None:
                _append_coords_clean(road_coords, list(edge_data["geometry"].coords))
            else:
                _append_coords_clean(
                    road_coords,
                    [
                        (float(G.nodes[nu]["x"]), float(G.nodes[nu]["y"])),
                        (float(G.nodes[nv]["x"]), float(G.nodes[nv]["y"])),
                    ],
                )

        # 3. Tambahkan potongan segmen jalan tujuan (dari node terakhir tepat ke depan titik posko)
        if geom_end.geom_type == "LineString":
            _append_coords_clean(road_coords, list(geom_end.coords))
        else:
            _append_coords_clean(road_coords, [(snap_dest_pt.x, snap_dest_pt.y)])

        segment_count = max(1, len(node_path) + 1)

    # Sambungkan titik awal klik pengguna -> proyeksi jalan -> rute jalan -> proyeksi jalan posko -> titik posko
    full_route_coords: list[list[float]] = []
    _append_coords_clean(full_route_coords, [(orig_lon, orig_lat)])
    _append_coords_clean(full_route_coords, road_coords)
    _append_coords_clean(full_route_coords, [(dest_lon, dest_lat)])

    start_connector = [
        [round(orig_lon, 6), round(orig_lat, 6)],
        [round(float(snap_orig_pt.x), 6), round(float(snap_orig_pt.y), 6)],
    ]
    end_connector = [
        [round(float(snap_dest_pt.x), 6), round(float(snap_dest_pt.y), 6)],
        [round(dest_lon, 6), round(dest_lat, 6)],
    ]

    return (
        full_route_coords,
        start_connector,
        end_connector,
        total_time_s,
        total_dist_m,
        segment_count,
    )


# ──────────────────────────────────────────────────────────
# Endpoint Utama
# ──────────────────────────────────────────────────────────
@app.post("/find-route")
def find_route(req: LocationRequest):
    """
    Tahapan Komputasi Sesuai Proposal:
    1. Transformasi titik pengguna dari EPSG:4326 ke UTM Zona 50S (EPSG:32750) via to_crs().
    2. Proyeksi presisi titik pengguna & posko ke ruas jalan/gang terdekat pada peta.
    3. Operasi GIS 1 (Buffering): 2.000 meter (perluasan adaptif ke 5.000 meter jika kosong).
    4. Operasi GIS 2 (Spatial Join): gpd.sjoin() dengan predikat 'intersects'.
    5. Pathfinding Algoritma A* (A-Star) untuk mencari posko terdekat & rute jalan tercepat
       mulai dari titik awal pengguna hingga tepat ke titik posko.
    """
    if not state:
        raise HTTPException(status_code=503, detail="Data OSM belum selesai dimuat.")

    G: nx.MultiDiGraph = state["G"]
    posko_gdf_utm: gpd.GeoDataFrame = state["posko_gdf_utm"]
    posko_gdf: gpd.GeoDataFrame = state["posko_gdf"]

    # ── 1. Validasi Batas Wilayah Kota Palu ──
    city_gdf: gpd.GeoDataFrame = state["city_gdf"]
    city_geom = city_gdf.geometry.iloc[0]
    user_point_geo = Point(req.lon, req.lat)

    if not city_geom.contains(user_point_geo):
        raise HTTPException(
            status_code=400,
            detail="Titik yang Anda pilih berada di luar wilayah administratif Kota Palu. Silakan pilih lokasi di dalam area Kota Palu.",
        )

    # ── 2. Transformasi CRS Titik Pengguna: EPSG:4326 -> EPSG:32750 (UTM Zona 50S) ──
    user_gdf = gpd.GeoDataFrame(geometry=[user_point_geo], crs=CRS_GEO)
    user_gdf_utm = user_gdf.to_crs(CRS_UTM)
    user_point_utm = user_gdf_utm.geometry.iloc[0]

    # ── 3. Operasi GIS 1 (Buffering Adaptif Bertahap: 2 km -> 5 km -> 10 km -> 15 km) ──
    # dan Operasi GIS 2 (Spatial Join Intersects)
    buffer_radii = [2000, 5000, 10000, 15000]
    candidate_gdf = gpd.GeoDataFrame()
    selected_radius = 2000
    buffer_utm = None

    for rad in buffer_radii:
        selected_radius = rad
        buffer_utm = user_point_utm.buffer(rad)
        buffer_gdf = gpd.GeoDataFrame(geometry=[buffer_utm], crs=CRS_UTM)
        candidate_gdf = gpd.sjoin(
            posko_gdf_utm,
            buffer_gdf,
            how="inner",
            predicate="intersects",
        )
        if not candidate_gdf.empty:
            break

    radius = selected_radius

    if candidate_gdf.empty:
        raise HTTPException(
            status_code=404,
            detail=(
                "Tidak ditemukan posko bencana bahkan setelah radius diperluas hingga 15 km. "
                "Silakan pilih titik lokasi lain di dalam wilayah Kota Palu."
            ),
        )

    # ── 3. Proyeksi presisi titik pengguna & kandidat posko ke ruas jalan/gang terdekat (vektorisasi) ──
    cand_indices = list(candidate_gdf.index)
    all_lons = [req.lon] + [float(posko_gdf.loc[idx, "geometry"].x) for idx in cand_indices]
    all_lats = [req.lat] + [float(posko_gdf.loc[idx, "geometry"].y) for idx in cand_indices]
    snapped_edges = ox.distance.nearest_edges(G, all_lons, all_lats)
    orig_edge = tuple(snapped_edges[0])
    dest_edges_map = {idx: tuple(snapped_edges[i + 1]) for i, idx in enumerate(cand_indices)}

    # ── 4. Pathfinding Algoritma A* ke setiap kandidat posko hasil Spatial Join ──
    best_route_coords: list[list[float]] | None = None
    best_start_conn: list[list[float]] = []
    best_end_conn: list[list[float]] = []
    best_travel_time: float = float("inf")
    best_road_dist_m: float = 0.0
    best_seg_count: int = 0
    best_posko_idx: int = -1
    candidates_list: list[dict[str, Any]] = []

    for idx, row in candidate_gdf.iterrows():
        orig_row = posko_gdf.loc[idx]
        p_lon = float(orig_row["geometry"].x)
        p_lat = float(orig_row["geometry"].y)
        dest_edge = dest_edges_map[idx]

        posko_pt_utm = posko_gdf_utm.loc[idx, "geometry"]
        euclidean_m = round(float(user_point_utm.distance(posko_pt_utm)), 1)

        try:
            (
                route_coords,
                start_conn,
                end_conn,
                travel_time,
                road_distance_m,
                seg_count,
            ) = _compute_precise_route(
                G,
                req.lon,
                req.lat,
                orig_edge,
                p_lon,
                p_lat,
                dest_edge,
            )

            candidates_list.append(
                {
                    "idx": idx,
                    "id": orig_row["id"],
                    "nama": orig_row["nama"],
                    "kategori": orig_row["kategori"],
                    "lon": p_lon,
                    "lat": p_lat,
                    "euclidean_meters": euclidean_m,
                    "distance_meters": round(road_distance_m, 1),
                    "distance_km": round(road_distance_m / 1000.0, 2),
                    "travel_time_seconds": round(travel_time),
                    "travel_time_minutes": round(travel_time / 60.0, 1),
                    "route_coords": route_coords,
                    "start_connector": start_conn,
                    "end_connector": end_conn,
                    "road_segments_count": seg_count,
                }
            )

            if travel_time < best_travel_time:
                best_travel_time = travel_time
                best_road_dist_m = road_distance_m
                best_seg_count = seg_count
                best_route_coords = route_coords
                best_start_conn = start_conn
                best_end_conn = end_conn
                best_posko_idx = idx  # type: ignore[assignment]
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            continue

    if best_route_coords is None:
        raise HTTPException(
            status_code=404,
            detail="Tidak ditemukan akses jaringan jalan yang terhubung menuju kandidat posko.",
        )

    # Urutkan daftar kandidat posko berdasarkan waktu tempuh tercepat
    candidates_list.sort(key=lambda c: c["travel_time_seconds"])
    for c in candidates_list:
        c["terpilih"] = c["idx"] == best_posko_idx
        c.pop("idx", None)

    # ── 5. Susun GeoJSON Response (dikembalikan ke EPSG:4326) ──

    buffer_geo = gpd.GeoDataFrame(geometry=[buffer_utm], crs=CRS_UTM).to_crs(CRS_GEO)
    buffer_geojson = json.loads(buffer_geo.to_json())["features"][0]

    posko_features = []
    for c in candidates_list:
        posko_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
                "properties": {
                    "type": "candidate_posko",
                    "id": c["id"],
                    "nama": c["nama"],
                    "kategori": c["kategori"],
                    "terpilih": c["terpilih"],
                    "distance_km": c["distance_km"],
                    "distance_meters": c["distance_meters"],
                    "travel_time_minutes": c["travel_time_minutes"],
                },
            }
        )

    route_features = []
    # Rute utama posko tercepat (rekomendasi utama)
    route_features.append(
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": best_route_coords},
            "properties": {
                "type": "route",
                "target_posko_id": posko_gdf.loc[best_posko_idx, "id"],
                "travel_time_seconds": round(best_travel_time),
                "travel_time_minutes": round(best_travel_time / 60.0, 1),
                "distance_meters": round(best_road_dist_m, 1),
                "distance_km": round(best_road_dist_m / 1000.0, 2),
                "road_segments_count": best_seg_count,
            },
        }
    )

    connector_features = [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": best_start_conn},
            "properties": {
                "type": "connector_line",
                "target_posko_id": posko_gdf.loc[best_posko_idx, "id"],
            },
        },
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": best_end_conn},
            "properties": {
                "type": "connector_line",
                "target_posko_id": posko_gdf.loc[best_posko_idx, "id"],
            },
        },
    ]

    # Sertakan juga rute alternatif untuk setiap opsi posko lainnya
    for c in candidates_list:
        if not c.get("terpilih"):
            route_features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": c["route_coords"]},
                    "properties": {
                        "type": "route",
                        "target_posko_id": c["id"],
                        "travel_time_seconds": c["travel_time_seconds"],
                        "travel_time_minutes": c["travel_time_minutes"],
                        "distance_meters": c["distance_meters"],
                        "distance_km": c["distance_km"],
                        "road_segments_count": c["road_segments_count"],
                    },
                }
            )
            connector_features.extend([
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": c["start_connector"]},
                    "properties": {
                        "type": "connector_line",
                        "target_posko_id": c["id"],
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": c["end_connector"]},
                    "properties": {
                        "type": "connector_line",
                        "target_posko_id": c["id"],
                    },
                },
            ])

    best_posko_info = posko_gdf.loc[best_posko_idx]
    best_posko_utm = posko_gdf_utm.loc[best_posko_idx, "geometry"]
    best_euclidean_m = round(float(user_point_utm.distance(best_posko_utm)), 1)

    posko_info = {
        "id": best_posko_info["id"],
        "nama": best_posko_info["nama"],
        "kategori": best_posko_info["kategori"],
        "lon": float(best_posko_info["geometry"].x),
        "lat": float(best_posko_info["geometry"].y),
        "travel_time_seconds": round(best_travel_time),
        "travel_time_minutes": round(best_travel_time / 60.0, 1),
        "distance_meters": round(best_road_dist_m, 1),
        "distance_km": round(best_road_dist_m / 1000.0, 2),
        "euclidean_meters": best_euclidean_m,
        "radius_meter": radius,
        "candidates_count": len(candidates_list),
        "road_segments_count": best_seg_count,
        "user_utm_x": round(float(user_point_utm.x), 2),
        "user_utm_y": round(float(user_point_utm.y), 2),
        "crs_projected": CRS_UTM,
    }

    return {
        "posko_info": posko_info,
        "candidates": candidates_list,
        "geojson": {
            "type": "FeatureCollection",
            "features": [
                {
                    **buffer_geojson,
                    "properties": {"type": "buffer", "radius_meter": radius},
                },
                *connector_features,
                *route_features,
                *posko_features,
            ],
        },
    }


@app.get("/posko")
def get_all_posko():
    """Layer 3 (Point): Kembalikan semua titik posko bencana dari OpenStreetMap dalam GeoJSON."""
    if not state:
        raise HTTPException(status_code=503, detail="Data OSM belum siap.")
    return state["posko_geojson"]


@app.get("/boundary")
def get_city_boundary():
    """Layer 1 (Polygon): Kembalikan poligon batas wilayah administratif Kota Palu dalam GeoJSON."""
    if not state:
        raise HTTPException(status_code=503, detail="Data OSM belum siap.")
    return state["boundary_geojson"]


@app.get("/roads")
def get_road_network():
    """Layer 2 (LineString): Kembalikan struktur garis jaringan jalan Kota Palu dalam GeoJSON."""
    if not state:
        raise HTTPException(status_code=503, detail="Data OSM belum siap.")
    return state["roads_geojson"]


@app.get("/layers-summary")
def get_layers_summary():
    """Ringkasan statistik ke-3 Spatial Layers Vektor Kota Palu."""
    if not state:
        raise HTTPException(status_code=503, detail="Data OSM belum siap.")
    return {
        "crs_input_output": CRS_GEO,
        "crs_computation": CRS_UTM,
        "polygon_boundary_count": len(state["city_gdf"]),
        "linestring_roads_count": len(state["roads_geojson"]["features"]),
        "road_nodes_count": len(state["G"].nodes),
        "point_posko_count": len(state["posko_gdf"]),
    }


@app.get("/health")
def health():
    return {"status": "ok", "data_loaded": bool(state)}
