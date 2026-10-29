@echo off
REM ── Setup & Jalankan Backend GIS Palu ──────────────────────────────────────
echo.
echo  =====================================================
echo   Sistem Rute Posko Bencana - Backend Python (FastAPI)
echo  =====================================================
echo.

REM Buat virtual environment jika belum ada
if not exist "venv" (
    echo [1/4] Membuat Python virtual environment...
    python -m venv venv
)

REM Aktifkan venv
echo [2/4] Mengaktifkan virtual environment...
call venv\Scripts\activate.bat

REM Install dependensi
echo [3/4] Menginstal dependensi Python...
pip install -r requirements.txt

REM Jalankan server
echo [4/4] Menjalankan FastAPI server di http://localhost:8000 ...
echo        (Pertama kali: OSM akan diunduh, harap tunggu 1-3 menit)
echo.
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
